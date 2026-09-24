// Dedicated Vercel route for /api/health. The actual health handler is defined
// in src/server/app.ts, so this file only adapts it to Vercel's API folder.
//
// The server is TypeScript. `npm run build` compiles it to dist-server/, and
// this file loads the compiled app, so Vercel and Docker run the same output.
const app = require('../dist-server/src/server/app').default;

module.exports = app;
