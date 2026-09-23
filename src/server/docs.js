const express = require('express');
const spec = require('./openapi.json');

// Swagger UI ships about 12 MB of static assets, so it is loaded on the first
// visit to /api/docs instead of at startup. That keeps cold starts on serverless
// hosts as fast as before for everyone who never opens the docs.
let uiRouter;

function buildUiRouter() {
  const swaggerUi = require('swagger-ui-express');
  const router = express.Router();

  router.use(swaggerUi.serve);
  router.get(
    '/',
    swaggerUi.setup(spec, {
      customSiteTitle: 'IT Ticketing System API',
      swaggerOptions: { persistAuthorization: true, tryItOutEnabled: true },
    })
  );

  return router;
}

const docsRouter = express.Router();

// The raw document, for tools that generate clients or import into Postman.
docsRouter.get('/openapi.json', (_req, res) => res.json(spec));

// Relative asset URLs on the docs page only resolve under a trailing slash.
docsRouter.get('/docs', (req, res, next) => {
  if (req.originalUrl.split('?')[0].endsWith('/')) return next();
  return res.redirect(301, `${req.baseUrl}/docs/`);
});

docsRouter.use('/docs', (req, res, next) => {
  uiRouter = uiRouter || buildUiRouter();
  uiRouter(req, res, next);
});

module.exports = { docsRouter, spec };
