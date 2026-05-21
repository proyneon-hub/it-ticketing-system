const dns = require('dns');
const mongoose = require('mongoose');

// Cached state prevents repeated MongoDB handshakes. This is especially helpful
// in serverless environments where several requests can reuse a warm function.
let cachedConnection = null;
let connectingPromise = null;
let dnsConfigured = false;

function getConnectionTimeoutMs() {
  // Keep the API from hanging indefinitely when MongoDB or DNS is unreachable.
  return Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS) || 5000;
}

function withConnectionTimeout(promise, timeoutMs) {
  let timeoutId;

  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(`MongoDB connection timed out after ${timeoutMs}ms.`);
      error.code = 'ETIMEOUT';
      reject(error);
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function configureDnsServers(uri) {
  if (dnsConfigured || !uri.startsWith('mongodb+srv://')) {
    return;
  }

  // mongodb+srv:// URLs require DNS SRV lookups. Some local networks have
  // unreliable DNS for Atlas, so development can opt into public DNS servers.
  const configuredServers = process.env.MONGODB_DNS_SERVERS;
  const defaultDevServers = process.env.NODE_ENV === 'production' ? '' : '8.8.8.8,1.1.1.1';
  const servers = (configuredServers || defaultDevServers)
    .split(',')
    .map((server) => server.trim())
    .filter(Boolean);

  if (servers.length > 0) {
    dns.setServers(servers);
  }

  dnsConfigured = true;
}

async function connectToDatabase() {
  // Mongoose readyState 1 means the existing connection is open and reusable.
  if (cachedConnection && mongoose.connection.readyState === 1) {
    return cachedConnection;
  }

  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error('MONGODB_URI is missing. Add it to .env locally and to Vercel Environment Variables in production.');
  }

  configureDnsServers(uri);

  // Share one in-flight connection attempt across concurrent requests. If five
  // requests arrive at once, they all await the same promise instead of opening
  // five independent database connections.
  if (!connectingPromise) {
    const timeoutMs = getConnectionTimeoutMs();

    connectingPromise = withConnectionTimeout(
      mongoose.connect(uri, {
        serverSelectionTimeoutMS: timeoutMs,
        connectTimeoutMS: timeoutMs,
        socketTimeoutMS: timeoutMs
      }),
      timeoutMs
    );
  }

  try {
    cachedConnection = await connectingPromise;
  } catch (error) {
    // Reset failed state so the next request can retry a fresh connection.
    connectingPromise = null;
    await mongoose.disconnect().catch(() => {});
    throw error;
  }

  return cachedConnection;
}

function isDatabaseConnectivityError(error) {
  // The Express error handler uses this to return a 503 with deployment guidance
  // for known network/connectivity failures.
  return [
    'MongoNetworkError',
    'MongoNetworkTimeoutError',
    'MongooseServerSelectionError'
  ].includes(error.name) || ['ETIMEOUT', 'ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET'].includes(error.code);
}

module.exports = { connectToDatabase, isDatabaseConnectivityError };
