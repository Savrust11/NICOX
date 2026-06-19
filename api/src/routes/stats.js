const express = require('express');
const db = require('../db');

const router = express.Router();

// GET /api/stats/public — global aggregate counts (Level 1, public).
// Always returns only counts. If ?area_id is passed, counts are restricted to that area.
router.get('/public', async (req, res) => {
  const { area_id } = req.query;
  try {
    if (area_id) {
      const r = await db.query(
        `
        WITH a AS (SELECT geometry FROM areas WHERE id = $1)
        SELECT
          (SELECT COUNT(*) FROM reports r, a WHERE ST_Contains(a.geometry, r.location::geometry)) AS total_reports,
          (SELECT COUNT(*) FROM reports r, a WHERE r.status = 'pending' AND ST_Contains(a.geometry, r.location::geometry)) AS pending_reports,
          (SELECT COUNT(*) FROM hotspots h, a WHERE h.status NOT IN ('resolved','discarded') AND ST_Contains(a.geometry, h.centroid::geometry)) AS active_hotspots,
          (SELECT COUNT(*) FROM hotspots h, a WHERE h.status = 'high_priority' AND ST_Contains(a.geometry, h.centroid::geometry)) AS high_priority_hotspots,
          (SELECT COUNT(*) FROM hotspots h, a WHERE h.status = 'resolved' AND ST_Contains(a.geometry, h.centroid::geometry)) AS resolved_hotspots,
          (SELECT COUNT(*) FROM interventions i JOIN hotspots h ON i.hotspot_id = h.id, a
             WHERE i.status = 'completed' AND ST_Contains(a.geometry, h.centroid::geometry)) AS completed_interventions
        `,
        [area_id]
      );
      return res.json({ stats: r.rows[0] });
    }
    const r = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM reports)                                            AS total_reports,
        (SELECT COUNT(*) FROM reports WHERE status = 'pending')                   AS pending_reports,
        (SELECT COUNT(*) FROM hotspots WHERE status NOT IN ('resolved','discarded')) AS active_hotspots,
        (SELECT COUNT(*) FROM hotspots WHERE status = 'high_priority')            AS high_priority_hotspots,
        (SELECT COUNT(*) FROM hotspots WHERE status = 'resolved')                 AS resolved_hotspots,
        (SELECT COUNT(*) FROM interventions WHERE status = 'completed')           AS completed_interventions
    `);
    res.json({ stats: r.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load public stats' });
  }
});

// GET /api/stats/public/areas — list every area with its public-level counts.
// Used by the Level 1 page to show a per-city breakdown.
router.get('/public/areas', async (_req, res) => {
  try {
    const r = await db.query(`
      SELECT
        a.id,
        a.name,
        a.area_type,
        ST_Y(ST_Centroid(a.geometry)) AS lat,
        ST_X(ST_Centroid(a.geometry)) AS lng,
        (SELECT COUNT(*) FROM reports r WHERE ST_Contains(a.geometry, r.location::geometry))::int AS total_reports,
        (SELECT COUNT(*) FROM reports r WHERE r.status = 'pending' AND ST_Contains(a.geometry, r.location::geometry))::int AS pending_reports,
        (SELECT COUNT(*) FROM hotspots h WHERE h.status NOT IN ('resolved','discarded') AND ST_Contains(a.geometry, h.centroid::geometry))::int AS active_hotspots,
        (SELECT COUNT(*) FROM hotspots h WHERE h.status = 'high_priority' AND ST_Contains(a.geometry, h.centroid::geometry))::int AS high_priority_hotspots
      FROM areas a
      ORDER BY a.name
    `);
    res.json({ areas: r.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load area stats' });
  }
});

module.exports = router;
