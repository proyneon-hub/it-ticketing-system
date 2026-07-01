# Incident Report - API health check failed

- Severity: HIGH
- Detected Time: 2026-07-01T13:00:00Z
- Affected Service: IT Ticketing System

## Symptoms

Scheduled support automation detected that `/api/health` did not return the expected healthy response.

## Checks Performed

- API health check
- Synthetic login validation
- Authenticated ticket API check
- Recent deployment and environment-variable review

## Suspected Cause

The application may have a deployment configuration issue or a failed server startup.

## Next Actions

Review hosting logs, verify environment variables, redeploy if needed, and rerun the support checks.

## Escalation Notes

Escalate to the application owner if the health endpoint remains unhealthy after deployment and environment checks.
