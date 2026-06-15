const express = require('express');
const cors = require('cors');
const path = require('path');
const { connectToDatabase, isDatabaseConnectivityError } = require('./db');
const authRoutes = require('./routes/auth');
const ticketRoutes = require('./routes/tickets');

const app = express();

// CORS allows the Vite dev server and the API server to talk across ports.
app.use(cors());
// All API endpoints accept JSON bodies. The 1mb limit is plenty for ticket text
// and prevents accidentally accepting very large payloads.
app.use(express.json({ limit: '1mb' }));

// Lightweight endpoint for deployment checks and quick local API verification.
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'it-ticketing-system' });
});

// Demo authentication routes are intentionally available before the database
// middleware so reviewers can sign in even while configuring MongoDB.
app.use('/api', authRoutes);

// Every /api route after health needs the database. The connection helper caches
// successful connections, which is important for both local dev and Vercel.
app.use('/api', async (_req, _res, next) => {
  try {
    await connectToDatabase();
    next();
  } catch (error) {
    next(error);
  }
});

// Mount the ticket CRUD routes under /api, producing URLs like /api/tickets.
app.use('/api', ticketRoutes);

if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '..', '..', 'dist');
  app.use(express.static(distPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    return res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Any request that reaches this point did not match a route above.
app.use((req, res) => {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.path}` });
});

// Central error handler. Route handlers call next(error), then this converts the
// error into a consistent JSON response for the frontend.
app.use((error, _req, res, _next) => {
  if (error.message && error.message.includes('MONGODB_URI is missing')) {
    console.error(error.message);
    return res.status(503).json({
      message: 'Database is not configured. Add MONGODB_URI in Vercel Project Settings, then redeploy.'
    });
  }

  // Known MongoDB connection failures become a service-unavailable response
  // with deployment guidance instead of a vague internal server error.
  if (isDatabaseConnectivityError(error)) {
    console.error('Database connection failed:', error.message);
    return res.status(503).json({
      message: 'Database unavailable. Check MONGODB_URI in Vercel and allow access from Vercel in MongoDB Atlas Network Access.'
    });
  }

  const statusCode = error.statusCode || 500;
  const message = statusCode === 500 ? 'Internal server error.' : error.message;

  // Log only unexpected server errors to avoid noisy logs for normal 400/404s.
  if (statusCode === 500) {
    console.error(error);
  }

  res.status(statusCode).json({ message });
});

module.exports = app;
