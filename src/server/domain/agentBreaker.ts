// The agent's circuit breaker: when the model or the API it depends on is failing, stop asking, and
// send tickets to people, until it has had time to recover (docs/adr/014).
//
// It keeps no state of its own. It is worked out from the record of runs, which every instance reads
// from the same database, so a serverless deployment with many small processes agrees on it without
// anything to keep in step. Pure: the runs and the time come in, an answer goes out.

export interface BreakerConfig {
  // Failed runs in a row that open it.
  failures: number;
  // How long it stays open after the latest failure. Then the next run is a probe: if it works the
  // breaker closes, and if it fails the breaker opens again for another cooldown.
  cooldownMs: number;
}

export const DEFAULT_BREAKER: BreakerConfig = { failures: 5, cooldownMs: 10 * 60 * 1000 };

type Env = Record<string, string | undefined>;

const positive = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return value?.trim() && Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const breakerConfig = (env: Env = process.env): BreakerConfig => ({
  failures: Math.floor(positive(env.AGENT_BREAKER_FAILURES, DEFAULT_BREAKER.failures)),
  cooldownMs: positive(env.AGENT_BREAKER_COOLDOWN_MS, DEFAULT_BREAKER.cooldownMs),
});

// A run that really tried something: finished, one way or another. Runs that were stopped on purpose
// before the model was asked (kill switch, cost cap, a limit, this breaker) say nothing about whether
// the model works, so they neither count as failures nor as recoveries.
export interface AttemptRecord {
  outcome: string;
  at: Date;
}

export interface BreakerState {
  open: boolean;
  // Failed runs in a row, newest first, up to the ones the record covers.
  consecutiveFailures: number;
  // When it will let a run through again. Only while open.
  reopensAt?: Date;
}

// `attempts` is newest first.
export function breakerState(
  attempts: AttemptRecord[],
  now: Date,
  config: BreakerConfig = DEFAULT_BREAKER
): BreakerState {
  let consecutiveFailures = 0;
  for (const attempt of attempts) {
    if (attempt.outcome !== 'error') break;
    consecutiveFailures += 1;
  }
  const latest = attempts[0];
  if (consecutiveFailures < config.failures || !latest) return { open: false, consecutiveFailures };

  const reopensAt = new Date(latest.at.getTime() + config.cooldownMs);
  return now < reopensAt
    ? { open: true, consecutiveFailures, reopensAt }
    : { open: false, consecutiveFailures };
}
