const express = require('express');
const multer = require('multer');
const db = require('../db');
const { uploadBuffer } = require('../storage');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// POST /api/reports — submit a new report
router.post('/', async (req, res) => {
  const {
    reporter_id,
    longitude,
    latitude,
    reported_at,
    source = 'web',
    notes,
    is_anonymous = false,
    // sighting_details fields
    cat_count,
    has_ear_cut,
    has_kitten,
    behavior,
    behavior_notes,
    // involvement
    involvement_level,
    funding_willing,
  } = req.body;

  if (!longitude || !latitude) {
    return res.status(400).json({ error: 'longitude and latitude are required' });
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const reportResult = await client.query(
      `INSERT INTO reports (reporter_id, location, reported_at, source, notes, is_anonymous)
       VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4, $5, $6, $7)
       RETURNING id`,
      [
        reporter_id || null,
        longitude,
        latitude,
        reported_at || new Date(),
        source,
        notes || null,
        is_anonymous,
      ]
    );

    const reportId = reportResult.rows[0].id;

    await client.query(
      `INSERT INTO sighting_details
         (report_id, cat_count, has_ear_cut, has_kitten, behavior, behavior_notes, additional_info)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        reportId,
        cat_count || null,
        has_ear_cut ?? null,
        has_kitten ?? null,
        behavior || null,
        behavior_notes || null,
        JSON.stringify({ involvement_level: involvement_level || null, funding_willing: funding_willing ?? null }),
      ]
    );

    // Lightweight merge: assign to nearest active hotspot within 100m
    await client.query(
      `INSERT INTO hotspot_reports (hotspot_id, report_id)
       SELECT h.id, $1
       FROM hotspots h
       WHERE ST_DWithin(h.centroid, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, 100)
         AND h.status = 'active'
       ORDER BY ST_Distance(h.centroid, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography)
       LIMIT 1
       ON CONFLICT DO NOTHING`,
      [reportId, longitude, latitude]
    );

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

// GET /api/reports — list reports with optional filters
router.get('/', async (req, res) => {
  const { status, limit = 50, offset = 0 } = req.query;

  let query = `
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
      sd.has_ear_cut,
      sd.has_kitten,
      sd.behavior,
      sd.additional_info
    FROM reports r
    LEFT JOIN sighting_details sd ON r.id = sd.report_id
  `;
  const params = [];

  if (status) {
    params.push(status);
    query += ` WHERE r.status = $${params.length}`;
  }

  query += ` ORDER BY r.reported_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  try {
    const result = await db.query(query, params);
    res.json({ reports: result.rows, total: result.rowCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

// POST /api/reports/:id/media — upload image for a report
router.post('/:id/media', upload.single('image'), async (req, res) => {
  const { id } = req.params;

  if (!req.file) {
    return res.status(400).json({ error: 'image file is required' });
  }

  try {
    const url = await uploadBuffer(req.file.buffer, req.file.mimetype);

    const result = await db.query(
      `INSERT INTO media (report_id, url, media_type, taken_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id, url`,
      [id, url, req.file.mimetype, new Date()]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

// PATCH /api/reports/:id/status — update report status
router.patch('/:id/status', async (req, res) => {
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
