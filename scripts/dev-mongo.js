// Starts a throwaway MongoDB so the app can run without installing or hosting a
// database:  npm run dev:db   then   MONGODB_URI=mongodb://127.0.0.1:27017/it_ticketing
// Data lives in memory and disappears when the process stops.
const { MongoMemoryServer } = require('mongodb-memory-server');

const port = Number(process.env.DEV_MONGO_PORT) || 27017;

async function main() {
  const server = await MongoMemoryServer.create({ instance: { port } });
  console.log(`In-memory MongoDB ready: mongodb://127.0.0.1:${port}/it_ticketing`);
  console.log('Press Ctrl+C to stop.');

  const stop = async () => {
    await server.stop();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((error) => {
  console.error('Could not start the in-memory MongoDB:', error.message);
  process.exit(1);
});
