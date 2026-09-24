# ADR 004: Authentication with short-lived tokens, a rotating refresh cookie and argon2id

Status: accepted

## Context

The first version had three demo accounts hard-coded in the source, a home-made HMAC token kept in `localStorage`, and, on Vercel, a fallback to a signing secret that was in the repository (DEF-015). A script that runs in the page could read the token, a token could not be revoked, there was no way to end a session, and nothing recorded who signed in or was refused.

## Decision

- **Users live in MongoDB** with an argon2id hash (19 MiB, 2 passes, the minimum OWASP settings), computed with `hash-wasm`. It is WebAssembly, so it behaves the same on Windows, Alpine and Vercel with no native build step. An unknown email is verified against a decoy hash, so the time a sign-in takes does not reveal whether the account exists.
- **Access token:** a 15-minute HS256 JWT (`jose`) with issuer and audience checks, kept in the client's memory only. In production a missing or shorter-than-32-character `AUTH_SECRET` makes every authenticated route answer `503` instead of signing with a public value.
- **Refresh token:** 32 random bytes in an `HttpOnly`, `SameSite=Strict` cookie scoped to `/api/auth`. Only its SHA-256 hash is stored. Refresh and sign-out also check the `Origin` header.
- **Rotation with reuse detection.** Each refresh marks the presented token as used and issues the next one in the same family. Presenting a token that was already used revokes the whole family and is audited, because the only way to hold a used token is to have copied it. A token that was revoked by sign-out or by a role change is refused without that reaction, so the real user is not punished for a session an admin ended.
- **Every security event** (sign-in success and failure, reuse, role change, delete, denied action) goes to an audit log with the request id. A failed audit write is logged and never fails the request.
- **Role changes end the user's sessions** and run in a transaction that also protects the last admin (a shared guard document makes two concurrent demotions conflict, so one of them retries and sees the other).

## Consequences

- A stolen access token works for at most 15 minutes, and a stolen refresh cookie is single use. A role change reaches an existing access token only when it expires (up to 15 minutes); the refresh tokens are revoked at once. The threat model in [SECURITY_NOTES.md](../SECURITY_NOTES.md#threat-model) lists what remains.
- The page has to restore its session on every load by trading the cookie for a token, which shows a short "Restoring your session" state. The client keeps only a hint in `localStorage` (never a credential) so a first-time visitor is not sent to a refresh that cannot succeed.
- **Cost:** hashing is deliberately expensive, and it runs on the main thread. In the final load test sign-in went from under 3 ms to 85 ms at the median and throughput fell from 787 to 295 req/s with 5% of traffic signing in ([PERFORMANCE.md](../PERFORMANCE.md#final-run-after-authentication-transactions-and-metrics)). Moving the hash to a worker thread or a native binding is the obvious next step.
- MongoDB must be a replica set (see [ADR 006](006-transactional-outbox.md)).

## Alternatives considered

- **Server-side sessions in the database.** Revocation is simpler, but every request needs a database read, which does not fit the serverless deployment.
- **Keeping the token in `localStorage`.** Rejected: any script injection could read it.
- **bcrypt or scrypt.** Acceptable, but argon2id is memory-hard and is what OWASP lists first.
- **An OIDC provider.** The right answer for production, and on the roadmap. It would replace the demo accounts rather than sit beside them.
