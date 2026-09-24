import express from 'express';
import path from 'path';
import { version } from '../../package.json';
import { docsRouter } from './docs';
import { hasStrongAuthSecret, resolveTrustProxy } from './config';
import { connectToDatabase, pingDatabase } from './db';
import { requestLogger } from './logger';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { corsPolicy, securityHeaders } from './middleware/security';
import authRoutes from './routes/auth';
import ticketRoutes from './routes/tickets';

const app = express();

app.set('trust proxy', resolveTrustProxy());

// The request id is created first so every later log line and error response can carry it.
app.use(requestLogger);
app.use(securityHeaders());
app.use(corsPolicy());
// All API endpoints accept JSON bodies. The 1mb limit is plenty for ticket text
// and prevents accidentally accepting very large payloads.
app.use(express.json({ limit: '1mb' }));

// Liveness: the process is up. Deliberately does not touch the database, so an
// orchestrator restarting on failure is not triggered by a database blip.
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'it-ticketing-system' });
});

// Readiness: the app can serve traffic, which requires a working database.
app.get('/api/ready', async (req, res) => {
  const details = {
    service: 'it-ticketing-system',
    version,
    commit: process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT || 'unknown',
    uptimeSeconds: Math.round(process.uptime()),
    // True when AUTH_SECRET is set and strong enough. Lets a deploy be checked
    // without exposing the secret or attempting a sign-in.
    authConfigured: hasStrongAuthSecret(),
  };

  try {
    await pingDatabase();
    res.json({ ok: true, database: 'up', ...details });
  } catch (error) {
    req.log.error({ err: error }, 'Readiness check failed');
    res.status(503).json({ ok: false, database: 'down', ...details });
  }
});

// Interactive API documentation. Public and database-free; set API_DOCS=off to hide it.
if (process.env.API_DOCS !== 'off') {
  app.use('/api', docsRouter);
}

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

// Mount the ticket routes under /api, producing URLs like /api/tickets.
app.use('/api', ticketRoutes);

if (process.env.NODE_ENV === 'production') {
  // The built React app. Relative to the working directory rather than this file,
  // because the compiled server lives in dist-server/ and would otherwise look in the wrong place.
  const distPath = process.env.CLIENT_DIST_DIR || path.join(process.cwd(), 'dist');
  app.use(express.static(distPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    return res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Any request that reaches this point did not match a route above.
app.use(notFoundHandler);

// Central error handler: every failure leaves as consistent JSON with a request id.
app.use(errorHandler);

export default app;
