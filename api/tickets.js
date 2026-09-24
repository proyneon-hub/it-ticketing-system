// Dedicated Vercel route for /api/tickets. All route behavior is implemented in
// src/server/routes/tickets.ts and mounted by the shared Express app.
//
// The server is TypeScript. `npm run build` compiles it to dist-server/, and
// this file loads the compiled app, so Vercel and Docker run the same output.
const app = require('../dist-server/src/server/app').default;

module.exports = app;
