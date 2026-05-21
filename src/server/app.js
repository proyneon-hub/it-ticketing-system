const express = require('express');
const cors = require('cors');
const { connectToDatabase, isDatabaseConnectivityError } = require('./db');
const ticketRoutes = require('./routes/tickets');

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'it-ticketing-system' });
});

app.use('/api', async (_req, _res, next) => {
  try {
    await connectToDatabase();
    next();
  } catch (error) {
    next(error);
  }
});

app.use('/api', ticketRoutes);

app.use((req, res) => {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.path}` });
});

app.use((error, _req, res, _next) => {
  if (isDatabaseConnectivityError(error)) {
    console.error('Database connection failed:', error.message);
    return res.status(503).json({
      message: 'Database unavailable. Check your MongoDB Atlas network access, DNS/VPN/firewall, and MONGODB_URI.'
    });
  }

  const statusCode = error.statusCode || 500;
  const message = statusCode === 500 ? 'Internal server error.' : error.message;

  if (statusCode === 500) {
    console.error(error);
  }

  res.status(statusCode).json({ message });
});

module.exports = app;
