const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');

// Security headers. `upgrade-insecure-requests` is dropped from the default CSP
// because it breaks plain-http localhost and Docker runs in Safari.
function securityHeaders() {
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
function corsPolicy(env = process.env) {
  const origins = (env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return cors({ origin: origins.length > 0 ? origins : false });
}

// Counts only failed sign-ins, so demo visitors switching between accounts are
// never locked out while password guessing is still throttled. The store is
// per-instance memory: best effort on serverless, exact on a single container.
function loginRateLimiter() {
  return rateLimit({
    windowMs: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    // A function, so the limit is read on every request (tests change it at runtime).
    limit: () => Number(process.env.LOGIN_RATE_LIMIT_MAX) || 10,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Tests log in constantly; they opt in by setting LOGIN_RATE_LIMIT_MAX.
    skip: () => process.env.NODE_ENV === 'test' && !process.env.LOGIN_RATE_LIMIT_MAX,
    handler: (req, res) =>
      res.status(429).json({
        message: 'Too many failed sign-in attempts. Try again later.',
        requestId: req.id,
      }),
  });
}

module.exports = { corsPolicy, loginRateLimiter, securityHeaders };
