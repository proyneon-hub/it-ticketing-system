import cors from 'cors';
import type { RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit, type Options } from 'express-rate-limit';
import helmet from 'helmet';

type Env = Record<string, string | undefined>;

// Security headers. `upgrade-insecure-requests` is dropped from the default CSP
// because it breaks plain-http localhost and Docker runs in Safari.
export function securityHeaders(): RequestHandler {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: { 'upgrade-insecure-requests': null },
    },
  });
}

// The app and API are served from one origin (the Vite dev proxy, Docker and
// Vercel all preserve that), so cross-origin access is off unless explicitly
// allowed with CORS_ORIGINS="https://a.example,https://b.example".
export function corsPolicy(env: Env = process.env): RequestHandler {
  const origins = (env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return cors({ origin: origins.length > 0 ? origins : false });
}

// Counts only failed sign-ins, so demo visitors switching between accounts are
// never locked out while password guessing is still throttled. The store is
// per-instance memory: best effort on serverless, exact on a single container.
export function loginRateLimiter(): RequestHandler {
  return rateLimit({
    windowMs: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    // A function, so the limit is read on every request (tests change it at runtime).
    limit: () => Number(process.env.LOGIN_RATE_LIMIT_MAX) || 10,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Tests log in constantly; they opt in by setting LOGIN_RATE_LIMIT_MAX.
    skip: () => process.env.NODE_ENV === 'test' && !process.env.LOGIN_RATE_LIMIT_MAX,
    handler: (req, res) => {
      res.status(429).json({
        message: 'Too many failed sign-in attempts. Try again later.',
        code: 'RATE_LIMITED',
        requestId: req.id,
      });
    },
  });
}

// Limits knowledge-base lookups, because each one runs a text query. The limit is per caller, not
// per address: staff behind one office address must not share a budget, and the agent calls from
// the server's own address. An agent token counts against its run, so one busy run cannot starve
// the next. It sits after authentication, so an unauthenticated flood is turned away before it
// reaches this or the database. The default (120 a minute) is far above any real use: a run reads
// the knowledge base a handful of times.
// The options only; routes/kb.ts calls rateLimit() with them, so the limit is built right next to
// the routes it protects (which is also where code scanning looks for it).
export function kbRateLimitOptions(): Partial<Options> {
  return {
    windowMs: Number(process.env.KB_RATE_LIMIT_WINDOW_MS) || 60 * 1000,
    limit: () => Number(process.env.KB_RATE_LIMIT_MAX) || 120,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) =>
      req.user
        ? req.user.runId
          ? `run:${req.user.runId}`
          : `user:${req.user.sub}`
        : ipKeyGenerator(req.ip ?? ''),
    // Tests make many lookups; they opt in by setting KB_RATE_LIMIT_MAX.
    skip: () => process.env.NODE_ENV === 'test' && !process.env.KB_RATE_LIMIT_MAX,
    handler: (req, res) => {
      res.status(429).json({
        message: 'Too many knowledge-base lookups. Try again shortly.',
        code: 'RATE_LIMITED',
        requestId: req.id,
      });
    },
  };
}

// A coarse limit by address, in front of authentication. It bounds what any one address can make
// the server do (checking a token, then a lookup) before it is known who is asking. It is set far
// above the per-caller limit, because an address can be a whole office or the server's own address
// (the agent calls from there), so it only ever stops a flood.
export function kbIpRateLimitOptions(): Partial<Options> {
  return {
    windowMs: Number(process.env.KB_RATE_LIMIT_WINDOW_MS) || 60 * 1000,
    limit: () => Number(process.env.KB_IP_RATE_LIMIT_MAX) || 600,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? ''),
    // Tests make many requests from one address; they opt in by setting KB_IP_RATE_LIMIT_MAX.
    skip: () => process.env.NODE_ENV === 'test' && !process.env.KB_IP_RATE_LIMIT_MAX,
    handler: (req, res) => {
      res.status(429).json({
        message: 'Too many knowledge-base lookups. Try again shortly.',
        code: 'RATE_LIMITED',
        requestId: req.id,
      });
    },
  };
}
