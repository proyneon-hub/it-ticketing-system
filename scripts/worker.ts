import 'dotenv/config';
import mongoose from 'mongoose';
import { connectToDatabase } from '../src/server/db';
import { logger } from '../src/server/logger';
import { deliverPending } from '../src/server/services/outboxService';
import { escalate } from '../src/server/services/slaService';

// The same two jobs the scheduler calls over HTTP (SLA escalation, outbox delivery), run on
// a timer inside a container: `docker compose up worker`. Both are safe to run at the same
// time as the API or another worker, so this can be scaled or restarted freely.

const intervalMs = Number(process.env.WORKER_INTERVAL_MS) || 30_000;
let stopping = false;
let wake: (() => void) | undefined;

async function runOnce(): Promise<void> {
  try {
    await connectToDatabase();
    const escalation = await escalate();
    const delivery = await deliverPending();
    logger.info({ escalation, delivery }, 'Worker run finished');
  } catch (error) {
    // Keep going: a database blip or a failing webhook must not stop the loop.
    logger.error({ err: error }, 'Worker run failed');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    wake = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}

async function main(): Promise<void> {
  logger.info({ intervalMs }, 'Worker started');
  while (!stopping) {
    await runOnce();
    if (!stopping) await sleep(intervalMs);
  }
  await mongoose.disconnect();
  logger.info('Worker stopped');
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stopping = true;
    wake?.();
  });
}

main().catch((error) => {
  logger.error({ err: error }, 'Worker crashed');
  process.exit(1);
});
