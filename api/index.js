// Vercel serverless entry point. Exporting the shared Express app lets local
// development and deployed API routes use the exact same backend code.
//
// The server is TypeScript. `npm run build` compiles it to dist-server/, and
// this file loads the compiled app, so Vercel and Docker run the same output.
const app = require('../dist-server/src/server/app').default;

module.exports = app;
