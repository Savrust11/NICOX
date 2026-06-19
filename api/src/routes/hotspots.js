const express = require('express');
const db = require('../db');
const { requireAuth, requireApproved, requireRole } = require('../auth');

const router = express.Router();

// GET /api/hotspots — list active hotspots (approved members and admins).
// Non-admin members are restricted to hotspots located inside their assigned areas.
router.get('/', requireAuth, requireApproved, async (req, res) => {
  const { status } = req.query;
  const params = [];
  const conds = [];
  if (status) {
    params.push(status);
    conds.push(`h.status = $${params.length}`);
  } else {
    conds.push(`h.status NOT IN ('resolved', 'discarded')`);
  }
  if (req.user.role !== 'admin') {
    params.push(req.user.id);
    conds.push(`EXISTS (
      SELECT 1 FROM user_areas ua
      JOIN areas a ON a.id = ua.area_id
      WHERE ua.user_id = $${params.length}
        AND ST_Contains(a.geometry, h.centroid::geometry)
    )`);
  }
  const whereClause = `WHERE ${conds.join(' AND ')}`;

  try {
    const result = await db.query(
      `SELECT
         h.id,
         ST_X(h.centroid::geometry) AS longitude,
         ST_Y(h.centroid::geometry) AS latitude,
         h.radius_meters,
         h.report_count,
         h.cat_count_estimate,
         h.has_kitten,
         h.has_ear_cut_visible,
         h.computed_priority_score,
         h.status,
         h.first_seen_at,
         h.last_seen_at,
         COUNT(DISTINCT i.id) AS intervention_count,
         MAX(i.performed_at) AS last_intervention_at
       FROM hotspots h
       LEFT JOIN interventions i ON h.id = i.hotspot_id AND i.status = 'completed'
       ${whereClause}
       GROUP BY h.id
       ORDER BY h.last_seen_at DESC`,
      params
    );
    res.json({ hotspots: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch hotspots' });
  }
});

// GET /api/hotspots/:id — single hotspot with its reports.
// Members can only fetch hotspots inside their assigned areas; admins unrestricted.
router.get('/:id', requireAuth, requireApproved, async (req, res) => {
  const { id } = req.params;

  if (req.user.role !== 'admin') {
    const allowed = await db.query(
      `SELECT 1 FROM hotspots h
         WHERE h.id = $1
           AND EXISTS (
             SELECT 1 FROM user_areas ua
             JOIN areas a ON a.id = ua.area_id
             WHERE ua.user_id = $2
               AND ST_Contains(a.geometry, h.centroid::geometry)
           )
         LIMIT 1`,
      [id, req.user.id]
    );
    if (!allowed.rowCount) return res.status(404).json({ error: 'Hotspot not found' });
  }

  try {
    const [hotspot, reports] = await Promise.all([
      db.query(
        `SELECT
           h.*,
           ST_X(h.centroid::geometry) AS longitude,
           ST_Y(h.centroid::geometry) AS latitude
         FROM hotspots h WHERE h.id = $1`,
        [id]
      ),
      db.query(
        `SELECT
           r.id,
           ST_X(r.location::geometry) AS longitude,
           ST_Y(r.location::geometry) AS latitude,
           r.reported_at,
           r.source,
           r.status,
           r.notes,
           sd.cat_count,
           sd.cat_count_range,
           sd.ear_cut_status,
           sd.kitten_status,
           sd.problem_types,
           sd.requests,
           sd.involvement_level,
           sd.funding_level,
           sd.funding_amount,
           sd.has_ear_cut,
           sd.has_kitten,
           COALESCE(
             (SELECT array_agg(m.url ORDER BY m.created_at) FROM media m WHERE m.report_id = r.id),
             ARRAY[]::VARCHAR[]
           ) AS media_urls
         FROM hotspot_reports hr
         JOIN reports r ON hr.report_id = r.id
         LEFT JOIN sighting_details sd ON r.id = sd.report_id
         WHERE hr.hotspot_id = $1
         ORDER BY r.reported_at DESC`,
        [id]
      ),
    ]);

    if (hotspot.rowCount === 0) return res.status(404).json({ error: 'Hotspot not found' });

    res.json({ hotspot: hotspot.rows[0], reports: reports.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch hotspot' });
  }
});

// PATCH /api/hotspots/:id/status — update hotspot status (admin)
router.patch('/:id/status', requireAuth, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const allowed = ['active', 'monitored', 'resolved'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });
  }

  try {
    const result = await db.query(
      `UPDATE hotspots SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id, status`,
      [status, id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Hotspot not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update hotspot status' });
  }
});

// POST /api/hotspots/refresh — manually trigger hotspot recalculation (admin)
router.post('/refresh', requireAuth, requireRole('admin'), async (req, res) => {
  const { days_back = 30, cluster_radius_meters = 100 } = req.body;

  try {
    const result = await db.query(
      `SELECT * FROM refresh_hotspots($1, $2)`,
      [days_back, cluster_radius_meters]
    );
    res.json({ hotspots_created: result.rows[0].hotspot_count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to refresh hotspots' });
  }
});

module.exports = router;
