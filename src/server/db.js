const mongoose = require('mongoose');

let cachedConnection = null;

async function connectToDatabase() {
  if (cachedConnection && mongoose.connection.readyState === 1) {
    return cachedConnection;
  }

  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error('MONGODB_URI is missing. Add it to .env locally and to Vercel Environment Variables in production.');
  }

  cachedConnection = await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000
  });

  return cachedConnection;
}

module.exports = { connectToDatabase };
