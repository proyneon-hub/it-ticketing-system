// Dedicated Vercel route for /api/auth/login. The shared Express app owns the
// actual authentication logic in src/server/routes/auth.js.
const app = require('../../src/server/app');

module.exports = app;
