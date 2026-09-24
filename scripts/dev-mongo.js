// Starts a throwaway MongoDB so the app can run without installing or hosting a
// database:  npm run dev:db   then   MONGODB_URI=<the URL it prints>
// Data lives in memory and disappears when the process stops.
//
// It runs as a one-node replica set, like Atlas does, because the API uses
// multi-document transactions (for example to keep at least one admin), and MongoDB
// only supports those on a replica set.
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const port = Number(process.env.DEV_MONGO_PORT) || 27017;

async function main() {
  const server = await MongoMemoryReplSet.create({
    replSet: { count: 1, name: 'rs0' },
    instanceOpts: [{ port }],
  });
  console.log(`In-memory MongoDB ready: ${server.getUri('it_ticketing')}`);
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
