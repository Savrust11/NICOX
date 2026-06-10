const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../auth');

const router = express.Router();

// GET /api/auth/me — return the current user (or null)
router.get('/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  const { id, name, email, organization, role, approval_status } = req.user;
  res.json({ user: { id, name, email, organization, role, approval_status } });
});

// GET /api/auth/pending — list pending approval requests (admin only)
router.get('/pending', requireAuth, requireRole('admin'), async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT id, name, email, organization, created_at
       FROM users
       WHERE approval_status = 'pending_approval'
       ORDER BY created_at ASC`
    );
    res.json({ pending: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load pending list' });
  }
});

// PATCH /api/auth/users/:id/approval — approve or reject (admin only)
router.patch('/users/:id/approval', requireAuth, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { decision } = req.body; // 'approved' | 'rejected'
  if (!['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be approved or rejected' });
  }
  try {
    const result = await db.query(
      `UPDATE users
         SET approval_status = $1,
             approved_at = CASE WHEN $1 = 'approved' THEN NOW() ELSE NULL END,
             approved_by_user_id = $2,
             updated_at = NOW()
       WHERE id = $3
       RETURNING id, name, email, approval_status`,
      [decision, req.user.id, id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update approval' });
  }
});

module.exports = router;
