const express = require('express');
const multer = require('multer');
const db = require('../db');
const { uploadBuffer } = require('../storage');
const { requireAuth, requireApproved, requireRole } = require('../auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const RANGE_TO_CAT_COUNT = { '1-3': 2, '4-10': 7, '10+': 15, 'unknown': null };

// POST /api/reports — submit a new report (mock-spec fields)
router.post('/', async (req, res) => {
  const {
    reporter_id,
    longitude,
    latitude,
    reported_at,
    source = 'web',
    notes,
    is_anonymous = false,
    problem_types,
    cat_count_range,
    ear_cut_status,
    kitten_status,
    behavior,
    behavior_notes,
    involvement_level,
    funding_level,
    funding_amount,
    requests,
  } = req.body;

  if (longitude == null || latitude == null) {
    return res.status(400).json({ error: 'longitude and latitude are required' });
  }

  // Derive legacy/aggregation-friendly fields
  const catCount = cat_count_range ? RANGE_TO_CAT_COUNT[cat_count_range] ?? null : null;
  const hasKitten = kitten_status === 'present';
  const hasEarCut = ear_cut_status === 'all' || ear_cut_status === 'some';

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const reportResult = await client.query(
      `INSERT INTO reports (reporter_id, location, reported_at, source, notes, is_anonymous)
       VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4, $5, $6, $7)
       RETURNING id`,
      [reporter_id || null, longitude, latitude, reported_at || new Date(), source, notes || null, is_anonymous]
    );
    const reportId = reportResult.rows[0].id;

    await client.query(
      `INSERT INTO sighting_details
         (report_id, cat_count, behavior, behavior_notes,
          problem_types, cat_count_range, ear_cut_status, kitten_status,
          involvement_level, funding_level, funding_amount, requests,
          has_kitten, has_ear_cut)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        reportId,
        catCount,
        behavior || null,
        behavior_notes || null,
        Array.isArray(problem_types) && problem_types.length > 0 ? problem_types : null,
        cat_count_range || null,
        ear_cut_status || null,
        kitten_status || null,
        involvement_level || null,
        funding_level || null,
        funding_amount != null && funding_amount !== '' ? Number(funding_amount) : null,
        Array.isArray(requests) && requests.length > 0 ? requests : null,
        kitten_status ? hasKitten : null,
        ear_cut_status ? hasEarCut : null,
      ]
    );

    // Try to link to nearest active hotspot within 100m
    const linkResult = await client.query(
      `INSERT INTO hotspot_reports (hotspot_id, report_id)
       SELECT h.id, $1
       FROM hotspots h
       WHERE ST_DWithin(h.centroid, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, 100)
         AND h.status IN ('active', 'monitoring', 'high_priority')
       ORDER BY ST_Distance(h.centroid, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography)
       LIMIT 1
       ON CONFLICT DO NOTHING
       RETURNING hotspot_id`,
      [reportId, longitude, latitude]
    );

    if (linkResult.rowCount > 0) {
      await client.query(
        `UPDATE hotspots SET
           report_count = report_count + 1,
           last_seen_at = NOW(),
           cat_count_estimate = COALESCE(cat_count_estimate, 0) + $1,
           has_kitten = has_kitten OR $2,
           has_ear_cut_visible = has_ear_cut_visible OR $3,
           updated_at = NOW()
         WHERE id = $4`,
        [catCount || 0, hasKitten, hasEarCut, linkResult.rows[0].hotspot_id]
      );
    } else {
      const newHs = await client.query(
        `INSERT INTO hotspots
           (centroid, radius_meters, report_count,
            first_seen_at, last_seen_at,
            cat_count_estimate, has_kitten, has_ear_cut_visible,
            status, created_at, updated_at)
         VALUES (ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 100, 1,
                 NOW(), NOW(), $3, $4, $5, $6, NOW(), NOW())
         RETURNING id`,
        [
          longitude, latitude,
          catCount || 1,
          hasKitten,
          hasEarCut,
          hasKitten ? 'high_priority' : 'monitoring',
        ]
      );
      await client.query(
        `INSERT INTO hotspot_reports (hotspot_id, report_id) VALUES ($1, $2)`,
        [newHs.rows[0].id, reportId]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ id: reportId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to create report' });
  } finally {
    client.release();
  }
});

// GET /api/reports — approved members and admins only.
// Non-admin members are restricted to reports located inside their assigned areas.
router.get('/', requireAuth, requireApproved, async (req, res) => {
  const { status, limit = 50, offset = 0 } = req.query;

  const params = [];
  const where = [];

  if (status) {
    params.push(status);
    where.push(`r.status = $${params.length}`);
  }

  if (req.user.role !== 'admin') {
    params.push(req.user.id);
    where.push(`EXISTS (
      SELECT 1 FROM user_areas ua
      JOIN areas a ON a.id = ua.area_id
      WHERE ua.user_id = $${params.length}
        AND ST_Contains(a.geometry, r.location::geometry)
    )`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const query = `
    SELECT
      r.id,
      ST_X(r.location::geometry) AS longitude,
      ST_Y(r.location::geometry) AS latitude,
      r.reported_at,
      r.source,
      r.status,
      r.notes,
      r.is_anonymous,
      sd.cat_count,
      sd.cat_count_range,
      sd.ear_cut_status,
      sd.kitten_status,
      sd.problem_types,
      sd.requests,
      sd.involvement_level,
      sd.funding_level,
      sd.funding_amount,
      sd.behavior,
      sd.has_kitten,
      sd.has_ear_cut,
      COALESCE(
        (SELECT array_agg(m.url ORDER BY m.created_at) FROM media m WHERE m.report_id = r.id),
        ARRAY[]::VARCHAR[]
      ) AS media_urls
    FROM reports r
    LEFT JOIN sighting_details sd ON r.id = sd.report_id
    ${whereSql}
    ORDER BY r.reported_at DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;
  params.push(limit, offset);

  try {
    const result = await db.query(query, params);
    res.json({ reports: result.rows, total: result.rowCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

router.post('/:id/media', upload.single('image'), async (req, res) => {
  const { id } = req.params;
  if (!req.file) return res.status(400).json({ error: 'image file is required' });

  try {
    const url = await uploadBuffer(req.file.buffer, req.file.mimetype);
    const result = await db.query(
      `INSERT INTO media (report_id, url, media_type, taken_at)
       VALUES ($1, $2, $3, $4) RETURNING id, url`,
      [id, url, req.file.mimetype, new Date()]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

router.patch('/:id/status', requireAuth, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const allowed = ['pending', 'processed', 'discarded'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });
  }
  try {
    const result = await db.query(
      `UPDATE reports SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id, status`,
      [status, id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Report not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

module.exports = router;
