# Security Notes

This is a portfolio demo, not a production identity system. This page states what is implemented, what is deliberately not, and what a production version would add.

## Authentication model

Demo users are defined in code and receive HMAC-SHA256 signed bearer tokens that expire after 8 hours. Their passwords are shown in the app on purpose, so reviewers can inspect role behaviour without creating accounts. That makes them public, not secret, and nothing here should be reused for real credentials.

## Implemented controls

| Area                 | Control                                                                                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authorization        | Roles are enforced in the API for every protected route. UI controls mirror them but are never the only check                                                     |
| Data scoping         | Requester visibility is applied in the database query, on lists, single reads, exports, stats and search. A requester asking for someone else's ticket gets `404` |
| Privilege boundaries | Requesters can edit only `title`, `description`, `priority` and `category`; identity, status, assignee and SLA fields stay with staff                             |
| Tokens               | Signature compared in constant time; expiry checked; tampered or malformed tokens rejected                                                                        |
| Input validation     | Zod schemas whitelist fields, cap lengths, and reject non-text values such as `search[$ne]=x`; unknown fields are dropped                                         |
| Injection            | Search text is escaped and matched literally; ids are validated before any query; CSV cells that could run as spreadsheet formulas are neutralised                |
| Brute force          | Failed sign-ins are rate limited per client address; successful sign-ins are not counted                                                                          |
| Browser hardening    | `helmet` security headers and a Content-Security-Policy that allows only same-origin scripts; CORS disabled unless `CORS_ORIGINS` lists an origin                 |
| Information exposure | Unexpected errors return a generic 500; stacks stay in the server log; headers and tokens are never logged                                                        |
| Request size         | JSON bodies are capped at 1 MB                                                                                                                                    |
| Traceability         | Every request has an id that appears in the response, the logs and any error                                                                                      |
| Configuration        | `server.js` refuses to start in production without `AUTH_SECRET`                                                                                                  |
| Container            | The image runs as the unprivileged `node` user, contains production dependencies only, and MongoDB is published to localhost only in Compose                      |
| Supply chain         | `npm audit` gates CI (high or critical production findings fail the build), and Dependabot proposes weekly updates for npm, pip, GitHub Actions and Docker        |

## Known limitations

- **Demo accounts and plaintext demo passwords in code.** There is no user database, no password hashing and no account management.
- **Token stored in `localStorage`.** Script injection could read it. The Content-Security-Policy limits that risk; httpOnly cookies with CSRF protection would remove it.
- **No token refresh or revocation.** A token stays valid until it expires or `AUTH_SECRET` changes.
- **Rate limit store is per instance.** It is exact on a single container and best effort across serverless instances.
- **Serverless fallback secret.** Serverless entry points cannot fail at boot without taking the demo offline, so a missing `AUTH_SECRET` logs a warning and uses the public development secret. Set `AUTH_SECRET` on every real deployment.
- **No audit trail beyond ticket activity.** Sign-ins and permission failures appear in the request log but are not recorded as security events.

## What a production version would add

- Persisted users with Argon2 or bcrypt password hashing, and an identity provider (OIDC) instead of demo accounts.
- Short-lived access tokens with refresh and revocation, delivered in httpOnly cookies.
- A shared rate-limit store such as Redis, and account lockout or step-up checks.
- A security event log for sign-ins, permission failures and administrative actions.
- Managed secret storage and rotation through the deployment platform.

## Data protection notes

- Do not commit `.env` files or real credentials.
- Avoid putting sensitive ticket content in logs; request logs record method, path, status and timing only.
- Restrict database network access to known application environments and use least-privilege database users.
- Rotate `AUTH_SECRET` if it is exposed; this also signs everyone out.
