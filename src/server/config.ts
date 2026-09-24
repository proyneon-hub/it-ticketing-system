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
