const db = require('./db');

async function verifyJwt(token) {
  const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) return null;
  return res.json();
}

// Verify the Bearer JWT, load the matching users row, attach to req.user.
// If no token: req.user = null (caller decides what to do).
async function loadUser(req, _res, next) {
  req.user = null;
  const header = req.headers.authorization || '';
  const m = header.match(/^Bearer (.+)$/i);
  if (!m) return next();

  try {
    const authUser = await verifyJwt(m[1]);
    if (!authUser?.id) return next();

    // Upsert / fetch the users row tied to this auth account
    let row = (
      await db.query('SELECT * FROM users WHERE auth_user_id = $1', [authUser.id])
    ).rows[0];

    if (!row) {
      // First time we see this auth user — create a pending member row
      const meta = authUser.user_metadata || {};
      row = (
        await db.query(
          `INSERT INTO users
             (auth_user_id, name, email, phone, organization, role, approval_status, is_active)
           VALUES ($1, $2, $3, $4, $5, 'member', 'pending_approval', TRUE)
           RETURNING *`,
          [
            authUser.id,
            meta.name || authUser.email?.split('@')[0] || 'unnamed',
            authUser.email,
            meta.phone || null,
            meta.organization || null,
          ]
        )
      ).rows[0];
    }

    req.user = row;
    next();
  } catch (err) {
    console.error('auth loadUser error:', err);
    next();
  }
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  next();
}

function requireApproved(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (req.user.approval_status !== 'approved' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Account is not approved yet' });
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

module.exports = { loadUser, requireAuth, requireApproved, requireRole };
