import 'dotenv/config';
import { connectToDatabase } from '../src/server/db';
import AuditEvent from '../src/server/models/AuditEvent';
import Comment from '../src/server/models/Comment';
import Counter from '../src/server/models/Counter';
import OutboxEvent from '../src/server/models/OutboxEvent';
import RefreshToken from '../src/server/models/RefreshToken';
import Ticket from '../src/server/models/Ticket';
import User from '../src/server/models/User';

// Makes the database's indexes match the models: drops the ones a model no longer
// defines and creates the missing ones. Run it once after deploying a change to an
// index, in particular the text index behind search (MongoDB allows one text index per
// collection and will not alter it in place, so the old one has to be dropped first), or
// after changing AUDIT_RETENTION_DAYS or OUTBOX_RETENTION_DAYS (an existing expiry is not
// changed by a normal index build).
//
//   npm run db:sync-indexes                   (from source)
//   node dist-server/scripts/sync-indexes.js  (from a build or the Docker image)
const MODELS = [Ticket, User, RefreshToken, AuditEvent, OutboxEvent, Comment, Counter];

async function main(): Promise<void> {
  await connectToDatabase();

  for (const model of MODELS) {
    const dropped = await model.syncIndexes();
    const indexes = await model.listIndexes();
    console.log(
      `${model.modelName}: ${dropped.length > 0 ? `dropped ${dropped.join(', ')}; ` : ''}indexes ${indexes.map((index) => index.name).join(', ')}`
    );
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
