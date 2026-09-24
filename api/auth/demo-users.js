// Dedicated Vercel route for /api/auth/demo-users so portfolio deployments can
// always load the seeded demo credentials.
//
// The server is TypeScript. `npm run build` compiles it to dist-server/, and
// this file loads the compiled app, so Vercel and Docker run the same output.
const app = require('../../dist-server/src/server/app').default;

module.exports = app;
