# Security Notes

## Current Authentication Model

This project uses demo authentication for portfolio review. Demo users are defined in code and receive signed bearer tokens. This is useful for recruiters and interviewers because they can inspect role behavior without creating accounts.

This setup is not intended to be a production identity system.

## Production Hardening Recommendations

A production version should add:

- Bcrypt or Argon2 password hashing
- Persistent user accounts stored in the database
- JWT or session expiry and rotation
- Rate limiting on login and sensitive routes
- Helmet security headers
- Stronger request validation with a schema validation library
- Audit logging for security-relevant actions
- Managed secret storage through the deployment platform
- HTTPS-only cookies if cookie sessions are used
- Role and permission tests for every protected endpoint

## Data Protection Notes

- Do not commit `.env` files or real credentials.
- Avoid storing sensitive ticket content in logs.
- Restrict database network access to known application environments.
- Use least-privilege database users.
- Rotate `AUTH_SECRET` if it is exposed.

## Authorization Notes

The API should remain the source of truth for permissions. UI-level disabled controls improve usability, but the backend must still enforce role rules for every request.
