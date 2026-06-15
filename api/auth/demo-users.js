// Dedicated Vercel route for /api/auth/demo-users so portfolio deployments can
// always load the seeded demo credentials.
const app = require('../../src/server/app');

module.exports = app;
