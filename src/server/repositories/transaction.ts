import mongoose, { type ClientSession } from 'mongoose';

// The handle a repository call takes to join a transaction. Services pass it along without
// knowing what it is, so they never import Mongoose.
export type Tx = ClientSession;

// Runs `work` in a transaction, retried if it loses a write conflict, so it may run more
// than once: keep it to database calls. Needs MongoDB to be a replica set (Atlas is; see
// docker-compose.yml and npm run dev:db).
export function transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  return mongoose.connection.transaction(work);
}
