require('dotenv').config();
const express = require('express');
const cors = require('cors');

const reportsRouter = require('./routes/reports');
const hotspotsRouter = require('./routes/hotspots');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/reports', reportsRouter);
app.use('/api/hotspots', hotspotsRouter);

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});

module.exports = app;
