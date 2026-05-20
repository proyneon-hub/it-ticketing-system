require('dotenv').config();

const app = require('./src/server/app');
const { connectToDatabase } = require('./src/server/db');

const port = process.env.PORT || 5000;

async function start() {
  try {
    await connectToDatabase();
    app.listen(port, () => {
      console.log(`IT Ticketing API running at http://localhost:${port}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

start();
