// The one Vercel serverless function. `vercel.json` rewrites every /api/* path to
// /api, so this file serves them all and Express does the route matching and the
// 404s. A single function means one bundle of the app and its dependencies per
// deployment instead of one per route file.
//
// The server is TypeScript. `npm run build` compiles it to dist-server/, and
// this file loads the compiled app, so Vercel and Docker run the same output.
const app = require('../dist-server/src/server/app').default;

module.exports = app;
