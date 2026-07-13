# GitHub Actions Live-Smoke Secrets

The live-smoke workflow is manual-only. Configure it only with a resettable demo or non-production account; never use production credentials or production data.

## Repository Setup

1. Open the repository on GitHub.
2. Go to **Settings** → **Secrets and variables** → **Actions**.
3. Select **New repository secret** for each required value.
4. Add the following secret names and their test-only values:

   - `LIVE_BASE_URL`
   - `E2E_ADMIN_EMAIL`
   - `E2E_ADMIN_PASSWORD`

5. Use **Actions** → **Live Smoke** → **Run workflow** to trigger the check after a deployment.

## Safety Requirements

- The URL must target a resettable demo or non-production environment.
- The account must be dedicated to testing and permitted to create and delete `PW-LIVE-*` tickets.
- Do not place secret values in source code, documentation, issue comments, logs, or screenshots.
- Rotate the test account password if it is exposed or no longer needed.
