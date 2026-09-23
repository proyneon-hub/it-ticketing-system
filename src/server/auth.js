const crypto = require('crypto');
const { MIN_AUTH_SECRET_LENGTH, hasStrongAuthSecret } = require('./config');
const { forbidden, serviceUnavailable, unauthorized } = require('./errors');
const { logger } = require('./logger');

const roles = ['admin', 'technician', 'user'];

const demoUsers = [
  {
    id: 'usr_admin',
    name: 'Priya Admin',
    email: 'admin@demo.local',
    password: 'AdminPass123!',
    role: 'admin',
  },
  {
    id: 'usr_tech',
    name: 'Theo Technician',
    email: 'tech@demo.local',
    password: 'TechPass123!',
    role: 'technician',
  },
  {
    id: 'usr_user',
    name: 'Una User',
    email: 'user@demo.local',
    password: 'UserPass123!',
    role: 'user',
  },
];

const DEFAULT_AUTH_SECRET = 'local-demo-secret-change-me';

// The development fallback is public (it is in this repository), so a token signed
// with it proves nothing. In production a missing or weak secret therefore stops
// authentication with a 503 instead of quietly accepting forgeable tokens. The
// rest of the API, such as health and docs, keeps working.
function getAuthSecret() {
  if (process.env.NODE_ENV !== 'production') return process.env.AUTH_SECRET || DEFAULT_AUTH_SECRET;

  if (!hasStrongAuthSecret()) {
    logger.error(
      `AUTH_SECRET is missing or shorter than ${MIN_AUTH_SECRET_LENGTH} characters; authentication is disabled.`
    );
    throw serviceUnavailable('Server authentication is not configured.');
  }

  return process.env.AUTH_SECRET;
}

function base64url(input) {
  return Buffer.from(JSON.stringify(input)).toString('base64url');
}

function sign(value) {
  return crypto.createHmac('sha256', getAuthSecret()).update(value).digest('base64url');
}

function issueToken(user) {
  const payload = {
    sub: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 8,
  };
  const encoded = base64url(payload);
  return `${encoded}.${sign(encoded)}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return null;

  const [encoded, signature] = token.split('.');
  const expected = sign(encoded);

  const signatureBuffer = Buffer.from(signature || '');
  const expectedBuffer = Buffer.from(expected);

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch (_error) {
    return null;
  }
  if (!roles.includes(payload.role) || payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  return payload;
}

function findDemoUserByEmail(email) {
  return demoUsers.find((user) => user.email.toLowerCase() === String(email || '').toLowerCase());
}

function authenticateDemoUser(email, password) {
  const user = findDemoUserByEmail(email);
  if (!user || user.password !== password) return null;
  const { password: _password, ...publicUser } = user;
  return publicUser;
}

function getTokenFromRequest(req) {
  const header = req.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

// Failures go through next() so they leave via the central error handler, with
// the same JSON shape and request id as every other error.
function requireAuth(req, res, next) {
  const user = verifyToken(getTokenFromRequest(req));
  if (!user) {
    return next(unauthorized('Authentication required.'));
  }
  req.user = user;
  next();
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return next(forbidden('You do not have permission to perform this action.'));
    }
    next();
  };
}

module.exports = {
  authenticateDemoUser,
  demoUsers,
  issueToken,
  requireAuth,
  requireRole,
  verifyToken,
};
