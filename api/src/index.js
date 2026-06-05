require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const reportsRouter = require('./routes/reports');
const hotspotsRouter = require('./routes/hotspots');

const app = express();

app.use(cors());
app.use(express.json());

// Never cache API responses
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  next();
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/reports', reportsRouter);
app.use('/api/hotspots', hotspotsRouter);

// Serve React SPA
const publicDir = path.join(__dirname, '..', 'public');

// Hashed assets — long cache, return 404 if missing (do NOT fall through to index.html)
app.use(
  '/assets',
  express.static(path.join(publicDir, 'assets'), {
    maxAge: '1y',
    immutable: true,
    fallthrough: false,
  })
);

// Other static files (favicon, etc.)
app.use(express.static(publicDir, { index: false }));

// HTML entrypoint — never cache, so users always get the latest asset references
app.get('*', (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.use((err, req, res, next) => {
  if (err && err.status === 404) {
    return res.status(404).json({ error: 'Not found' });
  }
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});

module.exports = app;
