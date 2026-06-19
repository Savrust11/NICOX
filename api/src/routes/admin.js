const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../auth');

const router = express.Router();

async function deleteAuthUser(authUserId) {
  const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users/${authUserId}`, {
    method: 'DELETE',
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Supabase auth delete failed: ${res.status}`);
  }
}

// All admin routes require admin role
router.use(requireAuth, requireRole('admin'));

async function logAction(actor, action, target_type, target_id, details = null) {
  try {
    await db.query(
      `INSERT INTO audit_log (actor_user_id, actor_email, action, target_type, target_id, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [actor?.id || null, actor?.email || null, action, target_type, String(target_id ?? ''), details]
    );
  } catch (e) {
    console.error('audit log failed', e);
  }
}

// ============================================================================
// DASHBOARD
// ============================================================================
router.get('/dashboard', async (_req, res) => {
  try {
    const [counts, byStatus, byArea, recent, topReporters] = await Promise.all([
      db.query(`
        SELECT
          (SELECT COUNT(*) FROM reports) AS total_reports,
          (SELECT COUNT(*) FROM reports WHERE reported_at >= NOW() - INTERVAL '1 day') AS reports_today,
          (SELECT COUNT(*) FROM reports WHERE reported_at >= NOW() - INTERVAL '7 days') AS reports_week,
          (SELECT COUNT(*) FROM reports WHERE reported_at >= NOW() - INTERVAL '30 days') AS reports_month,
          (SELECT COUNT(*) FROM users WHERE is_active = TRUE) AS active_users,
          (SELECT COUNT(*) FROM users WHERE approval_status = 'pending_approval') AS pending_approvals,
          (SELECT COUNT(*) FROM hotspots WHERE status NOT IN ('resolved','discarded')) AS active_hotspots,
          (SELECT COUNT(*) FROM hotspots WHERE status = 'high_priority') AS high_priority_hotspots,
          (SELECT COUNT(*) FROM interventions WHERE status = 'completed') AS completed_interventions
      `),
      db.query(`SELECT status, COUNT(*)::int AS count FROM reports GROUP BY status ORDER BY count DESC`),
      db.query(`
        SELECT COALESCE(a.name, '(エリア外)') AS area_name, COUNT(r.id)::int AS count
        FROM reports r
        LEFT JOIN areas a ON ST_Contains(a.geometry, r.location::geometry)
        GROUP BY a.name
        ORDER BY count DESC LIMIT 10
      `),
      db.query(`
        SELECT r.id, r.reported_at, r.status,
          ST_X(r.location::geometry) AS longitude,
          ST_Y(r.location::geometry) AS latitude,
          COALESCE(u.name, '匿名') AS reporter_name
        FROM reports r
        LEFT JOIN users u ON r.reporter_id = u.id
        ORDER BY r.reported_at DESC LIMIT 10
      `),
      db.query(`
        SELECT u.id, u.name, u.email, COUNT(r.id)::int AS report_count
        FROM users u
        JOIN reports r ON r.reporter_id = u.id
        WHERE r.reported_at >= NOW() - INTERVAL '30 days'
        GROUP BY u.id ORDER BY report_count DESC LIMIT 5
      `),
    ]);
    res.json({
      counts: counts.rows[0],
      reports_by_status: byStatus.rows,
      reports_by_area: byArea.rows,
      recent_reports: recent.rows,
      top_reporters: topReporters.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// ============================================================================
// USERS
// ============================================================================
router.get('/users', async (req, res) => {
  const { q, role, status, limit = 100, offset = 0 } = req.query;
  const params = [];
  const where = [];
  if (q) { params.push(`%${q}%`); where.push(`(u.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`); }
  if (role) { params.push(role); where.push(`u.role = $${params.length}`); }
  if (status) { params.push(status); where.push(`u.approval_status = $${params.length}`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(limit, offset);
  try {
    const result = await db.query(
      `SELECT u.id, u.name, u.email, u.organization, u.phone, u.role, u.approval_status,
              u.is_active, u.created_at, u.approved_at,
              (SELECT COUNT(*)::int FROM reports r WHERE r.reporter_id = u.id) AS report_count,
              (SELECT MAX(r.reported_at) FROM reports r WHERE r.reporter_id = u.id) AS last_report_at,
              (SELECT COUNT(*)::int FROM user_areas ua WHERE ua.user_id = u.id) AS area_count
       FROM users u
       ${whereSql}
       ORDER BY u.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const total = await db.query(`SELECT COUNT(*)::int AS c FROM users u ${whereSql}`, params.slice(0, params.length - 2));
    res.json({ users: result.rows, total: total.rows[0].c });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

router.patch('/users/:id', async (req, res) => {
  const { id } = req.params;
  const { role, is_active, approval_status, name, organization } = req.body;
  const fields = [];
  const params = [];
  if (role !== undefined) { params.push(role); fields.push(`role = $${params.length}`); }
  if (is_active !== undefined) { params.push(!!is_active); fields.push(`is_active = $${params.length}`); }
  if (approval_status !== undefined) {
    params.push(approval_status); fields.push(`approval_status = $${params.length}`);
    if (approval_status === 'approved') fields.push(`approved_at = NOW()`);
  }
  if (name !== undefined) { params.push(name); fields.push(`name = $${params.length}`); }
  if (organization !== undefined) { params.push(organization); fields.push(`organization = $${params.length}`); }
  if (!fields.length) return res.status(400).json({ error: 'No fields to update' });
  fields.push(`updated_at = NOW()`);
  params.push(id);
  try {
    const r = await db.query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING id, name, email, role, approval_status, is_active`,
      params
    );
    if (!r.rowCount) return res.status(404).json({ error: 'User not found' });
    await logAction(req.user, 'user.update', 'user', id, req.body);
    res.json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// GET /api/admin/users/:id/areas — list area ids assigned to a member
router.get('/users/:id/areas', async (req, res) => {
  const { id } = req.params;
  try {
    const r = await db.query(
      `SELECT a.id, a.name, a.area_type
       FROM user_areas ua JOIN areas a ON a.id = ua.area_id
       WHERE ua.user_id = $1 ORDER BY a.name`,
      [id]
    );
    res.json({ areas: r.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load user areas' });
  }
});

// PUT /api/admin/users/:id/areas — replace the user's area assignments
router.put('/users/:id/areas', async (req, res) => {
  const { id } = req.params;
  const { area_ids } = req.body;
  if (!Array.isArray(area_ids)) return res.status(400).json({ error: 'area_ids array required' });
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM user_areas WHERE user_id = $1`, [id]);
    if (area_ids.length) {
      const values = area_ids.map((_, i) => `($1, $${i + 2})`).join(', ');
      await client.query(
        `INSERT INTO user_areas (user_id, area_id) VALUES ${values} ON CONFLICT DO NOTHING`,
        [id, ...area_ids]
      );
    }
    await client.query('COMMIT');
    await logAction(req.user, 'user.areas_update', 'user', id, { area_ids });
    res.json({ ok: true, area_ids });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to update user areas' });
  } finally {
    client.release();
  }
});

router.delete('/users/:id', async (req, res) => {
  const { id } = req.params;
  if (Number(id) === Number(req.user.id)) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }
  try {
    const r = await db.query(`SELECT auth_user_id, email FROM users WHERE id = $1`, [id]);
    if (!r.rowCount) return res.status(404).json({ error: 'User not found' });
    const { auth_user_id, email } = r.rows[0];
    await db.query(`DELETE FROM users WHERE id = $1`, [id]);
    if (auth_user_id) {
      try { await deleteAuthUser(auth_user_id); }
      catch (e) { console.error('supabase auth delete failed', e); }
    }
    await logAction(req.user, 'user.delete', 'user', id, { email });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// ============================================================================
// REPORTS
// ============================================================================
router.get('/reports', async (req, res) => {
  const { q, status, from, to, has_photo, area_id, limit = 100, offset = 0 } = req.query;
  const params = [];
  const where = [];
  if (status) { params.push(status); where.push(`r.status = $${params.length}`); }
  if (from) { params.push(from); where.push(`r.reported_at >= $${params.length}`); }
  if (to) { params.push(to); where.push(`r.reported_at <= $${params.length}`); }
  if (q) { params.push(`%${q}%`); where.push(`(r.notes ILIKE $${params.length} OR sd.behavior_notes ILIKE $${params.length})`); }
  if (has_photo === 'true') where.push(`EXISTS (SELECT 1 FROM media m WHERE m.report_id = r.id)`);
  if (has_photo === 'false') where.push(`NOT EXISTS (SELECT 1 FROM media m WHERE m.report_id = r.id)`);
  if (area_id) { params.push(area_id); where.push(`EXISTS (SELECT 1 FROM areas a WHERE a.id = $${params.length} AND ST_Contains(a.geometry, r.location::geometry))`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(limit, offset);
  try {
    const result = await db.query(
      `SELECT r.id, r.reported_at, r.status, r.notes, r.source, r.is_anonymous,
              ST_X(r.location::geometry) AS longitude,
              ST_Y(r.location::geometry) AS latitude,
              sd.cat_count_range, sd.problem_types,
              COALESCE(u.name, '匿名') AS reporter_name,
              u.email AS reporter_email,
              (SELECT COUNT(*)::int FROM media m WHERE m.report_id = r.id) AS photo_count
       FROM reports r
       LEFT JOIN sighting_details sd ON sd.report_id = r.id
       LEFT JOIN users u ON r.reporter_id = u.id
       ${whereSql}
       ORDER BY r.reported_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const total = await db.query(
      `SELECT COUNT(*)::int AS c FROM reports r LEFT JOIN sighting_details sd ON sd.report_id = r.id ${whereSql}`,
      params.slice(0, params.length - 2)
    );
    res.json({ reports: result.rows, total: total.rows[0].c });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list reports' });
  }
});

router.get('/reports/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const [report, media] = await Promise.all([
      db.query(
        `SELECT r.*, ST_X(r.location::geometry) AS longitude, ST_Y(r.location::geometry) AS latitude,
                sd.*,
                u.name AS reporter_name, u.email AS reporter_email, u.phone AS reporter_phone
         FROM reports r
         LEFT JOIN sighting_details sd ON sd.report_id = r.id
         LEFT JOIN users u ON r.reporter_id = u.id
         WHERE r.id = $1`,
        [id]
      ),
      db.query(`SELECT id, url, media_type, created_at FROM media WHERE report_id = $1 ORDER BY created_at`, [id]),
    ]);
    if (!report.rowCount) return res.status(404).json({ error: 'Report not found' });
    res.json({ report: report.rows[0], media: media.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load report' });
  }
});

router.patch('/reports/:id', async (req, res) => {
  const { id } = req.params;
  const { status, notes } = req.body;
  const fields = [];
  const params = [];
  if (status !== undefined) { params.push(status); fields.push(`status = $${params.length}`); }
  if (notes !== undefined) { params.push(notes); fields.push(`notes = $${params.length}`); }
  if (!fields.length) return res.status(400).json({ error: 'No fields to update' });
  fields.push(`updated_at = NOW()`);
  params.push(id);
  try {
    const r = await db.query(
      `UPDATE reports SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING id, status, notes`,
      params
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Report not found' });
    await logAction(req.user, 'report.update', 'report', id, req.body);
    res.json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update report' });
  }
});

router.delete('/reports/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const r = await db.query(`DELETE FROM reports WHERE id = $1`, [id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Report not found' });
    await logAction(req.user, 'report.delete', 'report', id);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete report' });
  }
});

router.post('/reports/bulk-delete', async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids array required' });
  try {
    const r = await db.query(`DELETE FROM reports WHERE id = ANY($1::bigint[])`, [ids]);
    await logAction(req.user, 'report.bulk_delete', 'report', ids.join(','), { count: r.rowCount });
    res.json({ ok: true, deleted: r.rowCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to bulk delete' });
  }
});

// ============================================================================
// HOTSPOTS
// ============================================================================
router.get('/hotspots', async (_req, res) => {
  try {
    const [hotspots, meta] = await Promise.all([
      db.query(`
        SELECT h.id, ST_X(h.centroid::geometry) AS longitude, ST_Y(h.centroid::geometry) AS latitude,
               h.radius_meters, h.report_count, h.cat_count_estimate,
               h.has_kitten, h.has_ear_cut_visible, h.status,
               h.first_seen_at, h.last_seen_at, h.computed_priority_score,
               (SELECT a.name FROM areas a WHERE ST_Contains(a.geometry, h.centroid::geometry) LIMIT 1) AS area_name
        FROM hotspots h
        ORDER BY h.last_seen_at DESC
      `),
      db.query(`SELECT MAX(created_at) AS last_refresh FROM hotspots`),
    ]);
    res.json({ hotspots: hotspots.rows, last_refresh: meta.rows[0].last_refresh });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list hotspots' });
  }
});

router.delete('/hotspots/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const r = await db.query(`DELETE FROM hotspots WHERE id = $1`, [id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Hotspot not found' });
    await logAction(req.user, 'hotspot.delete', 'hotspot', id);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete hotspot' });
  }
});

router.post('/hotspots/refresh', async (req, res) => {
  const { days_back = 30, cluster_radius_meters = 100, min_points = 1, clear_existing = false } = req.body;
  try {
    if (clear_existing) {
      await db.query(`DELETE FROM hotspots`);
    }
    const result = await db.query(`SELECT * FROM refresh_hotspots($1, $2, $3)`, [days_back, cluster_radius_meters, min_points]);
    await logAction(req.user, 'hotspot.refresh', 'hotspot', null, { days_back, cluster_radius_meters, min_points, clear_existing });
    res.json({ hotspots_created: result.rows[0].hotspot_count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to refresh hotspots' });
  }
});

// ============================================================================
// AREAS
// ============================================================================
router.get('/areas', async (_req, res) => {
  try {
    const r = await db.query(`
      SELECT a.id, a.name, a.area_type, a.description, a.parent_id, a.responsible_user_id,
             u.name AS responsible_name,
             ST_AsGeoJSON(a.geometry) AS geometry_geojson,
             ST_Y(ST_Centroid(a.geometry)) AS lat,
             ST_X(ST_Centroid(a.geometry)) AS lng,
             a.created_at
      FROM areas a
      LEFT JOIN users u ON a.responsible_user_id = u.id
      ORDER BY a.name
    `);
    res.json({ areas: r.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list areas' });
  }
});

router.post('/areas', async (req, res) => {
  const { name, area_type = 'district', description, parent_id, responsible_user_id, geometry_geojson } = req.body;
  if (!name || !geometry_geojson) {
    return res.status(400).json({ error: 'name and geometry_geojson are required' });
  }
  try {
    const r = await db.query(
      `INSERT INTO areas (name, area_type, description, parent_id, responsible_user_id, geometry)
       VALUES ($1, $2, $3, $4, $5, ST_SetSRID(ST_GeomFromGeoJSON($6), 4326))
       RETURNING id, name`,
      [name, area_type, description || null, parent_id || null, responsible_user_id || null, JSON.stringify(geometry_geojson)]
    );
    await logAction(req.user, 'area.create', 'area', r.rows[0].id, { name });
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create area' });
  }
});

router.patch('/areas/:id', async (req, res) => {
  const { id } = req.params;
  const { name, area_type, description, parent_id, responsible_user_id, geometry_geojson } = req.body;
  const fields = [];
  const params = [];
  if (name !== undefined) { params.push(name); fields.push(`name = $${params.length}`); }
  if (area_type !== undefined) { params.push(area_type); fields.push(`area_type = $${params.length}`); }
  if (description !== undefined) { params.push(description); fields.push(`description = $${params.length}`); }
  if (parent_id !== undefined) { params.push(parent_id); fields.push(`parent_id = $${params.length}`); }
  if (responsible_user_id !== undefined) { params.push(responsible_user_id); fields.push(`responsible_user_id = $${params.length}`); }
  if (geometry_geojson !== undefined) {
    params.push(JSON.stringify(geometry_geojson));
    fields.push(`geometry = ST_SetSRID(ST_GeomFromGeoJSON($${params.length}), 4326)`);
  }
  if (!fields.length) return res.status(400).json({ error: 'No fields to update' });
  fields.push(`updated_at = NOW()`);
  params.push(id);
  try {
    const r = await db.query(
      `UPDATE areas SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING id, name`,
      params
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Area not found' });
    await logAction(req.user, 'area.update', 'area', id, req.body);
    res.json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update area' });
  }
});

router.delete('/areas/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const r = await db.query(`DELETE FROM areas WHERE id = $1`, [id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Area not found' });
    await logAction(req.user, 'area.delete', 'area', id);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete area' });
  }
});

// ============================================================================
// AUDIT LOG
// ============================================================================
router.get('/audit-log', async (req, res) => {
  const { action, actor_id, limit = 100, offset = 0 } = req.query;
  const params = [];
  const where = [];
  if (action) { params.push(action); where.push(`action = $${params.length}`); }
  if (actor_id) { params.push(actor_id); where.push(`actor_user_id = $${params.length}`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(limit, offset);
  try {
    const r = await db.query(
      `SELECT id, actor_user_id, actor_email, action, target_type, target_id, details, created_at
       FROM audit_log ${whereSql} ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json({ entries: r.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load audit log' });
  }
});

// ============================================================================
// CSV EXPORT
// ============================================================================
function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

router.get('/export/reports.csv', async (req, res) => {
  const { from, to, status } = req.query;
  const params = [];
  const where = [];
  if (status) { params.push(status); where.push(`r.status = $${params.length}`); }
  if (from) { params.push(from); where.push(`r.reported_at >= $${params.length}`); }
  if (to) { params.push(to); where.push(`r.reported_at <= $${params.length}`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  try {
    const r = await db.query(
      `SELECT r.id, r.reported_at, r.status, r.source, r.is_anonymous, r.notes,
              ST_X(r.location::geometry) AS longitude, ST_Y(r.location::geometry) AS latitude,
              sd.cat_count_range, sd.cat_count, sd.ear_cut_status, sd.kitten_status,
              sd.behavior, sd.behavior_notes, sd.problem_types, sd.requests,
              sd.involvement_level, sd.funding_level, sd.funding_amount,
              COALESCE(u.name, '匿名') AS reporter_name,
              u.email AS reporter_email,
              (SELECT COUNT(*)::int FROM media m WHERE m.report_id = r.id) AS photo_count
       FROM reports r
       LEFT JOIN sighting_details sd ON sd.report_id = r.id
       LEFT JOIN users u ON r.reporter_id = u.id
       ${whereSql}
       ORDER BY r.reported_at DESC`,
      params
    );
    const headers = [
      'id','reported_at','status','source','is_anonymous','reporter_name','reporter_email',
      'longitude','latitude','cat_count_range','cat_count','ear_cut_status','kitten_status',
      'behavior','behavior_notes','problem_types','requests','involvement_level','funding_level',
      'funding_amount','photo_count','notes',
    ];
    const rows = [headers.join(',')];
    for (const row of r.rows) {
      rows.push(headers.map(h => {
        const v = row[h];
        if (Array.isArray(v)) return csvEscape(v.join('|'));
        if (v instanceof Date) return csvEscape(v.toISOString());
        return csvEscape(v);
      }).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="reports-${new Date().toISOString().slice(0,10)}.csv"`);
    res.send('﻿' + rows.join('\n'));
    await logAction(req.user, 'export.reports', 'report', null, { count: r.rowCount, filter: { from, to, status } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to export' });
  }
});

module.exports = router;
