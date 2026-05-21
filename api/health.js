// Dedicated Vercel route for /api/health. The actual health handler is defined
// in src/server/app.js, so this file only adapts it to Vercel's API folder.
const app = require('../src/server/app');

module.exports = app;
