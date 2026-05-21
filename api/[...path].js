// Catch-all Vercel route for any /api path not covered by a more specific file.
// This keeps Express responsible for final route matching and 404 responses.
const app = require('../src/server/app');
module.exports = app;
