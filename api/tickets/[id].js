// Dedicated Vercel route for /api/tickets/:id. Express still performs the
// actual id validation, lookup, update, and delete behavior.
const app = require('../../src/server/app');

module.exports = app;
