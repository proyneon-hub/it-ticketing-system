# Cleanup Baseline

## Environment

- Date: 2026-07-13
- Node.js: v24.15.0
- npm: 11.17.0
- Branch: `chore/repository-cleanup`
- Starting commit: `7e4107d docs: reconcile live smoke validation`

## Commands and Results

| Command                        | Result                                                                                                   |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `git status`                   | Completed before branching; `CODEX_REMAINING_REPOSITORY_CLEANUP.md` was an untracked user-provided file. |
| `git branch --show-current`    | `main` before branch creation; cleanup work continues on `chore/repository-cleanup`.                     |
| `git log -1 --oneline`         | `7e4107d docs: reconcile live smoke validation`                                                          |
| `npm ci`                       | Passed on Node.js 24; installed 435 packages.                                                            |
| `npm run typecheck:playwright` | Passed.                                                                                                  |
| `npm test`                     | Passed: 2 suites, 10 Jest/Supertest tests.                                                               |
| `npm run format:check`         | Failed only because the untracked `CODEX_REMAINING_REPOSITORY_CLEANUP.md` is not Prettier-formatted.     |
| `npm run build`                | Passed.                                                                                                  |
| `npm run test:e2e`             | Passed: 60 executions (20 unique mocked tests across Chromium, Firefox, and WebKit).                     |
| `npm run test:a11y`            | Passed: 9 executions (3 Axe scenarios across Chromium, Firefox, and WebKit).                             |
| `npm audit`                    | Failed: 5 vulnerabilities (1 low, 1 moderate, 1 high, 2 critical). Remediation is deferred to Phase 3.   |

Live smoke tests were not run because this baseline did not verify that the required credentials target a resettable non-production environment.

## Warnings and Pre-existing Failures

- `npm ci` reported deprecated `inflight@1.0.6` and `glob@7.2.3` packages.
- npm reported a pending postinstall-script approval for `esbuild@0.25.12` in this local environment.
- The first sandboxed baseline attempt could not create Git refs or spawn npm lifecycle processes; the documented results above are from the clean elevated run and do not represent a repository failure.
- Existing validation documentation claims zero audit findings, which conflicts with this fresh baseline. Reconciliation is intentionally deferred to Phase 3.
