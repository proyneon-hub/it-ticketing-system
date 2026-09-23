// Refuses to boot a production server that would sign tokens with the public
// development secret. Called from server.js, the entry point for Docker and
// self-hosted runs.
function assertProductionConfig(env = process.env) {
  if (env.NODE_ENV === 'production' && !env.AUTH_SECRET) {
    throw new Error('AUTH_SECRET must be set when NODE_ENV=production.');
  }
}

// Behind a reverse proxy (Vercel, a load balancer) the client address comes from
// X-Forwarded-For. Trusting it when the app is exposed directly would let anyone
// spoof their address and dodge the login rate limit, so it is opt-in.
function resolveTrustProxy(env = process.env) {
  if (env.TRUST_PROXY !== undefined && env.TRUST_PROXY !== '') {
    const hops = Number(env.TRUST_PROXY);
    return Number.isInteger(hops) ? hops : env.TRUST_PROXY;
  }
  return env.VERCEL ? 1 : false;
}

module.exports = { assertProductionConfig, resolveTrustProxy };
