// Vercel serverless entry point. Exporting the shared Express app lets local
// development and deployed API routes use the exact same backend code.
const app = require('../src/server/app');
module.exports = app;
