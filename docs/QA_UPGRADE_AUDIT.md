# QA Upgrade Audit

## Current Test Architecture

- The root project is a CommonJS Node.js application with an engine requirement of Node.js 22 through 26; Node.js 24 is the tested CI runtime.
- The frontend is React and Vite on port 5173. Vite proxies `/api` to the Express API on port 5000 during local development; production Express can serve the Vite `dist` output.
- Root API and auth coverage uses Jest and Supertest. `npm test` delegates to `npm run test:api`, which preserves the existing `jest --runInBand` command.
- Playwright 1.61.1 is installed at the root. TypeScript mocked browser specs and their typed route-interception helper live in `tests/e2e-mocked`; the configuration starts Vite and runs Chromium.
- Root CI runs Node 24 formatting, Jest, a production build, and a non-blocking dependency audit. The separate E2E workflow installs Chromium and runs the root E2E command.

## Strengths

- API tests cover authentication, protected routes, validation, ticket behavior, exports, and dashboard statistics.
- The mocked Playwright helper provides deterministic users, ticket data, role scoping, CRUD operations, and CSV downloads.
- The application provides accessible labels and targeted `data-testid` attributes for the existing browser tests.
- The deployed demo and health endpoint are verified at `https://it-ticketing-system-pi.vercel.app/` and `https://it-ticketing-system-pi.vercel.app/api/health`.

## Limitations

- The application uses in-code demo authentication rather than a production identity provider; it is suitable for demonstration and resettable test environments only.
- Live smoke tests perform a controlled write and cleanup, so they remain explicitly opt-in and must target a resettable demo or non-production environment. GitHub Actions live smoke remains gated on repository secrets.
- The screenshot spec previously overwrote tracked portfolio images during a test run. It now writes screenshots to Playwright test output instead.
- The root package has no separate unit-test command; the current Jest suite is API/auth coverage, so `test:api` is the preserved baseline command.

## Phase 1 Files Changed

- `docs/QA_UPGRADE_AUDIT.md`
- `README.md`
- `DEPLOYMENT.md`
- `package.json`
- `.gitignore`
- `tests/e2e-mocked/screenshots.spec.ts`

## Risks and Compatibility Considerations

- The baseline install issue was resolved by stopping the locking local process. A clean `npm ci`, API suite, formatting check, production build, mocked cross-browser suite, and accessibility suite subsequently passed.
- Root documentation now uses the verified replacement deployment. The prior repository website URL returned 404.
- `Qa-Automation/` and `Support-Ops-Automation/` are independent projects with their own tooling and placeholder deployment documentation. They were audited but are outside this phase's root-only edit scope.
- No production credentials are required for the mocked root E2E suite. Keep `.env.example` tracked and do not commit real environment files.

## Phase 2 Update

- Added TypeScript and Node type definitions, `tsconfig.playwright.json`, and `npm run typecheck:playwright`.
- Converted the Playwright configuration, four browser specs, screenshot spec, and mock helper from JavaScript to TypeScript.
- Preserved CommonJS application compatibility with `module` and `moduleResolution` set to `Node16`.
- Removed the obsolete JavaScript Playwright files after the type check and migrated E2E suite passed.

## Phase 3 Update

- Added page objects for login, ticket dashboard, and ticket creation workflows.
- Added an automatic mocked-API fixture plus typed user and ticket data shared by the existing specs and mock helper.
- Refactored the existing browser tests to express business scenarios through fixtures and page-object methods while keeping assertions and test behavior intact.

## Phase 4 Update

- Renamed the deterministic suite to `tests/e2e-mocked` and updated root E2E commands accordingly.
- Expanded mocked UI coverage for authentication, role restrictions, ticket workflows, validation, filtering, requester-scoped CSV exports, API failures, and loading states.
- Added tagged scenarios and `docs/TEST_CASES.md`, including documented exclusions for behavior the current demo application does not support.

## Phase 5 Update

- Added a separate `playwright.live.config.ts` and `tests/smoke-live` suite that never imports mocked API support.
- Live checks skip by default and require an explicit enable flag plus configured credentials before login or ticket creation. A later local run passed health, admin-login, and ticket-create/cleanup checks using the app's non-real demo admin account; the local values remain ignored.
- The ticket lifecycle smoke test uses a `PW-LIVE-` prefix and deletes only the ticket it created.

## Phase 6 Update

- Added automated Axe checks for the mocked login, dashboard, and ticket-form states.
- Kept the manual accessibility checklist for checks Axe cannot reliably automate.

## Phase 7 Update

- Added Chromium, Firefox, and WebKit projects to the mocked regression configuration.
- Updated GitHub Actions to install all Playwright browsers, type-check, run regression and Axe suites, and retain report artifacts.
- Added a manual/scheduled live-smoke workflow that runs only when required repository secrets are configured.

## Phase 8 Update

- Restructured the README around verified application and QA capabilities, commands, documentation, and safety limitations.
- Added QA architecture and copy-ready portfolio/resume documentation with the live suite accurately described as safety-gated.

## Phase 9 Update

- Verified a clean install, strict Playwright type check, API tests, formatting, production build, and zero audit findings.
- Ran the three-browser mocked regression suite three consecutive times with 60 passing executions per run.
- Ran nine cross-browser Axe checks successfully. A subsequent configured live-smoke run passed all three health, login, and ticket-lifecycle checks.
