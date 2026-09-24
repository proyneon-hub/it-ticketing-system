import express, { type RequestHandler, type Router } from 'express';
import type { JsonObject } from 'swagger-ui-express';
import spec from './openapi.json';

// Swagger UI ships about 12 MB of static assets, so it is loaded on the first
// visit to /api/docs instead of at startup. That keeps cold starts on serverless
// hosts as fast as before for everyone who never opens the docs.
interface SwaggerUi {
  generateHTML: (typeof import('swagger-ui-express'))['generateHTML'];
  serveFiles: (typeof import('swagger-ui-express'))['serveFiles'];
}

const uiOptions = {
  customSiteTitle: 'IT Ticketing System API',
  swaggerOptions: { persistAuthorization: true, tryItOutEnabled: true },
};

let ui: { html: string; files: Router } | undefined;

function loadUi(): { html: string; files: Router } {
  const swaggerUi = require('swagger-ui-express') as SwaggerUi;
  const files = express.Router();
  files.use(swaggerUi.serveFiles(spec as unknown as JsonObject, uiOptions));
  return { html: swaggerUi.generateHTML(spec as unknown as JsonObject, uiOptions), files };
}

export const docsRouter = express.Router();

// The raw document, for tools that generate clients or import into Postman.
docsRouter.get('/openapi.json', (_req, res) => {
  res.json(spec);
});

// The page itself. It is served at /docs (no trailing slash) and points its relative
// asset URLs at /docs/ with a <base> tag. Vercel never routes a trailing-slash URL to
// the function, so /docs/ cannot be the address the page depends on.
docsRouter.get(['/docs', '/docs/'], (req, res) => {
  ui = ui || loadUi();
  const page = ui.html.replace('<head>', `<head><base href="${req.baseUrl}/docs/">`);
  res.type('html').send(page);
});

// Swagger UI's scripts, styles and init file, under /docs/.
const serveAssets: RequestHandler = (req, res, next) => {
  ui = ui || loadUi();
  ui.files(req, res, next);
};
docsRouter.use('/docs', serveAssets);

export { spec };
