const express = require('express');
const db = require('../db');

const router = express.Router();

// GET /api/stats/public — aggregate counts only (no location data, no individuals)
// Open to everyone (unauthenticated) — Level 1 visibility.
router.get('/public', async (_req, res) => {
  try {
    const result = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM reports)                                            AS total_reports,
        (SELECT COUNT(*) FROM reports WHERE status = 'pending')                   AS pending_reports,
        (SELECT COUNT(*) FROM hotspots WHERE status NOT IN ('resolved','discarded')) AS active_hotspots,
        (SELECT COUNT(*) FROM hotspots WHERE status = 'high_priority')            AS high_priority_hotspots,
        (SELECT COUNT(*) FROM hotspots WHERE status = 'resolved')                 AS resolved_hotspots,
        (SELECT COUNT(*) FROM interventions WHERE status = 'completed')           AS completed_interventions
    `);
    res.json({ stats: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load public stats' });
  }
});

module.exports = router;
