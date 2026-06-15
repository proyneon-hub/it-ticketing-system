// Dedicated Vercel route for /api/auth/me. Exporting the shared Express app
// keeps local and deployed auth behavior identical.
const app = require('../../src/server/app');

module.exports = app;
