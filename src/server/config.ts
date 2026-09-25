// HMAC-SHA256 tokens are only as strong as the secret behind them, so a short
// one is treated the same as a missing one.
export const MIN_AUTH_SECRET_LENGTH = 32;

type Env = Record<string, string | undefined>;

export function hasStrongAuthSecret(env: Env = process.env): boolean {
  return typeof env.AUTH_SECRET === 'string' && env.AUTH_SECRET.length >= MIN_AUTH_SECRET_LENGTH;
}

// Refuses to boot a production server that would sign tokens with the public
// development secret. Called from server.ts, the entry point for Docker and
// self-hosted runs. Serverless entry points cannot fail at boot, so auth.ts
// applies the same rule per request.
export function assertProductionConfig(env: Env = process.env): void {
  if (env.NODE_ENV !== 'production') return;

  if (!env.AUTH_SECRET) {
    throw new Error('AUTH_SECRET must be set when NODE_ENV=production.');
  }
  if (!hasStrongAuthSecret(env)) {
    throw new Error(
      `AUTH_SECRET must be at least ${MIN_AUTH_SECRET_LENGTH} characters when NODE_ENV=production.`
    );
  }
}

// Behind a reverse proxy (Vercel, a load balancer) the client address comes from
// X-Forwarded-For. Trusting it when the app is exposed directly would let anyone
// spoof their address and dodge the login rate limit, so it is opt-in.
export function resolveTrustProxy(env: Env = process.env): number | string | false {
  if (env.TRUST_PROXY !== undefined && env.TRUST_PROXY !== '') {
    const hops = Number(env.TRUST_PROXY);
    return Number.isInteger(hops) ? hops : env.TRUST_PROXY;
  }
  return env.VERCEL ? 1 : false;
}

// The secret that scheduled jobs (SLA escalation, outbox delivery) present as a bearer token.
// Like AUTH_SECRET it must be long: it is the only thing between the internet and the jobs.
export const MIN_CRON_SECRET_LENGTH = 32;

export function hasStrongCronSecret(env: Env = process.env): boolean {
  return typeof env.CRON_SECRET === 'string' && env.CRON_SECRET.length >= MIN_CRON_SECRET_LENGTH;
}

// The service desk agent is off unless AGENT_ENABLED=true, so a deployment that does not use
// it records nothing for it and behaves exactly as it did before the agent existed. Whether
// the agent can actually run (an API key, a mode per category) is checked by the agent itself.
export function agentEnabled(env: Env = process.env): boolean {
  return env.AGENT_ENABLED?.trim().toLowerCase() === 'true';
}

// Where ticket events are sent: a Discord or Slack incoming-webhook URL, or any endpoint
// that accepts a JSON POST. Unset means notifications are off: no events are recorded and
// the delivery job does nothing. An unusable value is treated the same way (and the caller
// logs it), rather than failing every ticket change.
export interface WebhookConfig {
  url: string;
  format: string | undefined;
}

export function webhookConfig(env: Env = process.env): WebhookConfig | null {
  const url = env.WEBHOOK_URL?.trim();
  if (!url) return null;
  try {
    const { protocol } = new URL(url);
    if (protocol !== 'https:' && protocol !== 'http:') return null;
  } catch {
    return null;
  }
  return { url, format: env.WEBHOOK_FORMAT?.trim().toLowerCase() || undefined };
}
