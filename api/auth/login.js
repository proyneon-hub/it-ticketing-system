// Dedicated Vercel route for /api/auth/login. The shared Express app owns the
// actual authentication logic in src/server/routes/auth.ts.
//
// The server is TypeScript. `npm run build` compiles it to dist-server/, and
// this file loads the compiled app, so Vercel and Docker run the same output.
const app = require('../../dist-server/src/server/app').default;

module.exports = app;
