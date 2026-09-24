# GitHub Actions Live-Smoke Secrets

Several workflows do nothing until their secrets exist, so a fork or a fresh clone never fails on a missing value. Configure the live-smoke account only with a dedicated demo or test account; never reuse a personal or real production credential.

## Repository Setup

1. Open the repository on GitHub.
2. Go to **Settings** → **Secrets and variables** → **Actions**.
3. Select **New repository secret** for each required value.
4. Add the following secret names and their test-only values:

   - `LIVE_BASE_URL`
   - `E2E_ADMIN_EMAIL`
   - `E2E_ADMIN_PASSWORD`

5. The `live-smoke` job in `CI` now runs after every push to `main` (see below). To run it by hand, use **Actions** → **CI** → **Run workflow**.

### All the secrets, and what uses them

| Secret                                                                                                    | Used by                              | Purpose                                                                                                                  |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `LIVE_BASE_URL`, `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`                                                  | `CI` (`live-smoke` job)              | Smoke-test the deployed site after each push to `main`                                                                   |
| `BASE_URL`, `CRON_SECRET`                                                                                 | `Scheduled jobs`                     | Call the SLA escalation and notification jobs every 30 minutes. `CRON_SECRET` must equal the value set in the deployment |
| `BASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `TECH_EMAIL`, `TECH_PASSWORD`, `USER_EMAIL`, `USER_PASSWORD` | `Support Ops Scheduled Health Check` | Check the live site every hour and open an `incident` issue if it fails                                                  |

### Require an approval before the live smoke test

The `live-smoke` job runs in an environment called `production-smoke`, which GitHub creates the first time the job runs. To make a person confirm that the deployment finished before the site is tested: **Settings** → **Environments** → **production-smoke** → tick **Required reviewers** and add yourself. Without a reviewer the job starts on its own (it still waits for the new commit to be live).

## Safety Requirements

- The URL must target a resettable demo or non-production environment.
- The account must be dedicated to testing and permitted to create and delete `PW-LIVE-*` tickets.
- Do not place secret values in source code, documentation, issue comments, logs, or screenshots.
- Rotate the test account password if it is exposed or no longer needed.
