# Support Runbook

## Application Overview

The IT Ticketing System is a React, Express, and MongoDB service desk app with demo authentication, role-based ticket access, ticket workflow updates, and support reporting features.

## Support Checklist

1. Confirm the affected environment and base URL.
2. Run `python -m support_ops.health_check`.
3. Run `python -m support_ops.synthetic_login`.
4. Run `python -m support_ops.ticket_api_check`.
5. Generate a status report with `python -m support_ops.report_generator`.
6. Open an incident report if any core check fails.

## Health Check Process

- Verify `/api/health` returns HTTP 200.
- Confirm the response includes `ok: true`.
- Compare response time with `LATENCY_THRESHOLD_MS`.
- If the endpoint fails, inspect deployment status and server logs.

## Login Failure Process

- Confirm demo credentials in environment variables.
- Test admin, technician, and user accounts.
- Verify invalid credentials still return HTTP 401.
- If all valid users fail, check auth route deployment and `AUTH_SECRET` consistency.

## MongoDB Connection Issue Process

- Confirm `MONGODB_URI` is set in the target environment.
- Check MongoDB Atlas network access for the hosting provider.
- Confirm database credentials have the expected permissions.
- Review server logs for connection timeout or authentication errors.

## Vercel Deployment Issue Process

- Confirm the latest deployment completed successfully.
- Review Vercel function logs for `/api/*` routes.
- Check environment variables in Vercel Project Settings.
- Redeploy after configuration changes.

## API Error Triage

- Capture endpoint, HTTP status, response body, and timestamp.
- Compare behavior between health, auth, and tickets endpoints.
- If auth works but tickets fail, prioritize database connectivity.
- If health fails, prioritize deployment or application startup.

## Escalation Process

- Escalate critical and high incidents with a generated incident report.
- Include status report output, environment, timestamp, and affected endpoints.
- Identify whether the next owner is application development, database administration, or hosting operations.

## Rollback Recommendation

If a new deployment correlates with the incident and configuration is valid, roll back to the last known healthy deployment, then rerun all support checks before closing the incident.
