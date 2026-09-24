import 'dotenv/config';
import { connectToDatabase } from '../src/server/db';
import Ticket from '../src/server/models/Ticket';

// Makes the database's indexes match the model: drops the ones the model no longer
// defines and creates the missing ones. Run it once after deploying a change to an
// index, in particular the text index behind search. MongoDB allows one text index per
// collection and will not alter it in place, so the old one has to be dropped first.
//
//   npm run db:sync-indexes                   (from source)
//   node dist-server/scripts/sync-indexes.js  (from a build or the Docker image)
async function main(): Promise<void> {
  await connectToDatabase();

  const dropped = await Ticket.syncIndexes();
  console.log(dropped.length > 0 ? `Dropped: ${dropped.join(', ')}` : 'Nothing to drop.');

  const indexes = await Ticket.listIndexes();
  console.log(`Indexes now: ${indexes.map((index) => index.name).join(', ')}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
