// Catch-all Vercel route for any /api path not covered by a more specific file.
// This keeps Express responsible for final route matching and 404 responses.
//
// The server is TypeScript. `npm run build` compiles it to dist-server/, and
// this file loads the compiled app, so Vercel and Docker run the same output.
const app = require('../dist-server/src/server/app').default;

module.exports = app;
