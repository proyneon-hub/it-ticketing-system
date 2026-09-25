import { waitUntil } from '@vercel/functions';
import { agentEnabled, hasStrongCronSecret } from '../config';
import { logger } from '../logger';
import { agentApiBaseUrl } from './agentWorkerService';

// Starts the agent soon after a ticket is created, on a platform with no long-running worker.
//
// The outbox already guarantees every ticket gets its event and that a scheduled job will pick it
// up (scripts/worker.ts in a container, the scheduled workflow on Vercel). This only makes it
// prompt: after the response has been sent, it asks the deployment to run the agent job, so the
// requester's comment arrives within a minute and not within half an hour. It is a nudge: if it
// fails, or is skipped, nothing is lost.
//
// On Vercel a function stops when it has answered, so the request is handed to waitUntil, which
// keeps the function alive until it finishes without delaying the response. It runs as a separate
// invocation from the ticket request, so a slow model can never slow down creating a ticket.

type Env = Record<string, string | undefined>;

// Long enough for a run to finish (the job stops taking new events well before this).
const KICK_TIMEOUT_MS = 150_000;

export interface KickOptions {
  env?: Env;
  fetchImpl?: typeof fetch;
  // For tests: what keeps the work alive after the response. Defaults to waitUntil.
  keepAlive?: (work: Promise<unknown>) => void;
}

// Whether a nudge makes sense here: only where the agent is on, the job endpoint is reachable
// (it needs the job secret), and this is Vercel. Elsewhere a worker loop runs the job on a timer.
export const shouldKick = (env: Env = process.env): boolean =>
  agentEnabled(env) && hasStrongCronSecret(env) && Boolean(env.VERCEL);

// Fire and forget: never throws, and never makes the caller wait.
export function kickAgent({
  env = process.env,
  fetchImpl = fetch,
  keepAlive = waitUntil,
}: KickOptions = {}): void {
  if (!shouldKick(env)) return;

  try {
    const work = fetchImpl(`${agentApiBaseUrl(env)}/api/jobs/agent-runs`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.CRON_SECRET}` },
      signal: AbortSignal.timeout(KICK_TIMEOUT_MS),
      redirect: 'error',
    })
      .then((response) => {
        if (!response.ok) logger.warn({ status: response.status }, 'Agent kick was not accepted');
      })
      .catch((error: unknown) => {
        logger.warn({ err: error }, 'Agent kick failed; the scheduled job will pick the ticket up');
      });
    keepAlive(work);
  } catch (error) {
    // Even building the request must not break creating a ticket.
    logger.warn({ err: error }, 'Agent kick could not be sent');
  }
}
