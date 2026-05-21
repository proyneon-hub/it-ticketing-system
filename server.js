require('dotenv').config();

const app = require('./src/server/app');

// The local Express server listens on PORT from .env when present.
// Vite's dev proxy is configured to expect this API on port 5000 by default.
const port = process.env.PORT || 5000;

const server = app.listen(port, () => {
  console.log(`IT Ticketing API running at http://localhost:${port}`);
});

// Surface a clear message when the API port is already taken. Without this,
// the dev server can fail with a less helpful low-level Node error.
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Stop the other API process or set PORT to a free port.`);
    console.error(`The Vite dev proxy expects the API at http://localhost:${port}.`);
    process.exit(1);
  }

  console.error('Failed to start server:', error);
  process.exit(1);
});
