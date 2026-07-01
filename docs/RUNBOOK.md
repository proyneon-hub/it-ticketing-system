# Application Support Runbook

## Local Startup Checklist

1. Confirm Node.js 20 or later is installed.
2. Run `npm install`.
3. Create `.env` from `.env.example`.
4. Set `MONGODB_URI`, `PORT`, and `AUTH_SECRET`.
5. Start MongoDB locally or confirm Atlas network access.
6. Run `npm run seed` for predictable demo tickets.
7. Run `npm run dev` and open `http://localhost:5173`.

## Production Deployment Checklist

- Confirm `MONGODB_URI` is set in the hosting provider.
- Confirm `AUTH_SECRET` is set and not committed to the repository.
- Run `npm test` and `npm run build` before deployment.
- Check `/api/health` after deployment.
- Log in with each demo role and verify ticket dashboard loading.

## Environment Variable Checklist

| Variable      | Required   | Purpose                   |
| ------------- | ---------- | ------------------------- |
| `MONGODB_URI` | Yes        | MongoDB connection string |
| `AUTH_SECRET` | Yes        | Signs demo bearer tokens  |
| `PORT`        | Local only | Express server port       |

## MongoDB Connection Troubleshooting

- Verify the connection string has the correct username, password, and database.
- Check Atlas Network Access allows the deployment environment.
- Confirm the database user has read/write permissions.
- Restart the app after environment variable changes.
- Review API logs for `Database unavailable` or connection timeout messages.

## Failed Login Troubleshooting

- Confirm the user is using one of the demo credentials in README.
- Check that the request is going to `/api/auth/login`.
- Clear local storage if an old token is still present.
- Confirm `AUTH_SECRET` is stable across server restarts.

## API 500 Troubleshooting

- Check server logs for the first stack trace.
- Confirm the request body is valid JSON.
- Verify MongoDB is reachable.
- Reproduce locally with the same route and payload.
- Add a regression test once the root cause is found.

## Vercel Deployment Troubleshooting

- Confirm Vercel project settings include `MONGODB_URI` and `AUTH_SECRET`.
- Redeploy after changing environment variables.
- Check the function logs for `/api` routes.
- Confirm `api/[...path].js` is deployed.
- Verify the frontend build output exists in `dist`.

## CI Failure Troubleshooting

- If `npm ci` fails, compare `package.json` and `package-lock.json`.
- If formatting fails, run `npm run format`.
- If tests fail, inspect the failing Jest test and reproduce locally.
- If build fails, check Vite output and recent frontend changes.
- If audit reports vulnerabilities, review whether they affect production dependencies.

## Rollback Steps

1. Identify the last known good commit or deployment.
2. Revert the faulty commit or redeploy the known good build.
3. Confirm `/api/health` responds successfully.
4. Log in as admin and verify the dashboard.
5. Document the incident and follow-up fix.

## Escalation Notes

Escalate when:

- Production data is unavailable.
- Authentication behaves inconsistently across users.
- A role can access another role's restricted workflow.
- A deployment fails after environment variables and build logs have been checked.
