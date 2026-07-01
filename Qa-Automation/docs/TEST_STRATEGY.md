# Test Strategy

## Purpose

This strategy defines how the QA Automation Portfolio Lab validates the IT Ticketing System through automated browser, API, accessibility, and permission checks.

## Test Levels

- UI end-to-end tests for critical user workflows.
- API tests for authentication, validation, and role permissions.
- Accessibility smoke checks for high-value screens.
- Regression tests for core service desk behavior.

## Scope

In scope:

- demo login for admin, technician, and user roles
- ticket creation, update, delete, search, and activity timeline checks
- user-scoped ticket visibility
- admin-only delete behavior
- technician workflow updates
- API auth and validation behavior
- basic accessibility rule checks

## Out Of Scope

- real identity provider authentication
- email notifications
- password reset
- load testing
- cross-browser matrix beyond Chromium
- visual regression baselines

## Test Environments

| Environment | URL                           |
| ----------- | ----------------------------- |
| Local       | `http://localhost:5173`       |
| Deployed    | configured through `BASE_URL` |

## Roles

| Role       | Expected Access                                                   |
| ---------- | ----------------------------------------------------------------- |
| Admin      | full queue, workflow updates, assignment updates, ticket deletion |
| Technician | full queue and workflow updates, no deletion                      |
| User       | create tickets and view requester-scoped tickets only             |

## Risk Areas

- role-based authorization bypass
- user visibility leaking tickets from other requesters
- destructive admin actions exposed to non-admins
- ticket lifecycle updates failing silently
- API validation accepting incomplete or invalid payloads
- deployment differences between local and hosted environments

## Automation Approach

The project uses a Page Object Model for UI flows, shared fixtures for demo users and ticket data, and a typed API client for setup, cleanup, and direct endpoint verification.

## CI Approach

GitHub Actions installs Node dependencies, installs Playwright browsers, type-checks the project, runs the full test suite, and uploads the Playwright HTML report.

## Limitations

- Tests rely on seeded demo users provided by the target application.
- API workflow tests create temporary tickets and delete them when admin cleanup is allowed.
- Accessibility checks currently fail on serious or critical axe violations, excluding `color-contrast` because the target app has a known near-threshold contrast finding that is documented separately for product follow-up.
