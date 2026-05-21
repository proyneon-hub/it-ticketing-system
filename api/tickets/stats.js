// Dedicated Vercel route for /api/tickets/stats. It exports the shared Express
// app so the stats endpoint stays in one central implementation.
const app = require('../../src/server/app');

module.exports = app;
