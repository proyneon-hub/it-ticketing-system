// Dedicated Vercel route for /api/auth/me. Exporting the shared Express app
// keeps local and deployed auth behavior identical.
//
// The server is TypeScript. `npm run build` compiles it to dist-server/, and
// this file loads the compiled app, so Vercel and Docker run the same output.
const app = require('../../dist-server/src/server/app').default;

module.exports = app;
