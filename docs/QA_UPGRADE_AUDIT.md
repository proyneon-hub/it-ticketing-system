# QA Upgrade Audit

## Current Test Architecture

- The root project is a CommonJS Node.js application with an engine requirement of Node.js 20 or later.
- The frontend is React and Vite on port 5173. Vite proxies `/api` to the Express API on port 5000 during local development; production Express can serve the Vite `dist` output.
- Root API and auth coverage uses Jest and Supertest. `npm test` delegates to `npm run test:api`, which preserves the existing `jest --runInBand` command.
- Playwright 1.61.1 is installed at the root. TypeScript mocked browser specs and their typed route-interception helper live in `tests/e2e-mocked`; the configuration starts Vite and runs Chromium.
- Root CI runs Node 20 formatting, Jest, a production build, and a non-blocking dependency audit. The separate E2E workflow installs Chromium and runs the root E2E command.

## Strengths

- API tests cover authentication, protected routes, validation, ticket behavior, exports, and dashboard statistics.
- The mocked Playwright helper provides deterministic users, ticket data, role scoping, CRUD operations, and CSV downloads.
- The application provides accessible labels and targeted `data-testid` attributes for the existing browser tests.
- The deployed demo and health endpoint are verified at `https://it-ticketing-system-pi.vercel.app/` and `https://it-ticketing-system-pi.vercel.app/api/health`.

## Limitations

- Playwright configuration, specs, and mock helper use strict TypeScript with Node16/CommonJS-compatible module resolution. Page objects, typed fixtures, and reusable test data cover the current mocked suite; separate mocked/live suites, accessibility automation, and cross-browser projects are future-phase work.
- Root browser tests share one `tests/e2e` directory and run only in Chromium. CI does not yet retain Playwright reports or diagnostics.
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

- The local baseline is pending: `npm ci` was blocked by a running `esbuild.exe`, and the interrupted install left Jest unavailable. Do not begin Phase 2 until a clean install and the Phase 1 validation commands pass.
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
- Live checks skip by default and require an explicit enable flag plus dedicated credentials before login or ticket creation.
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
- Added QA architecture and copy-ready portfolio/resume documentation without claiming unconfigured live smoke results.
