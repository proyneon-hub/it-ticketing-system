# QA Automation Portfolio Lab

## Overview

This project demonstrates QA automation skills through end-to-end browser tests, API tests, role-based permission checks, regression coverage, CI execution, and structured QA documentation.

It is a standalone Playwright + TypeScript framework that validates the IT Ticketing System from the outside, the way a QA automation or SDET team would test a deployed web application.

## Target Application

- Application: IT Ticketing System
- Local target: `http://localhost:5173`
- Deployed target: set `BASE_URL` to the deployed app URL

The tests do not hardcode an environment URL. They read `BASE_URL` and default to local Vite for development.

## Tech Stack

- Node.js 20+
- TypeScript
- Playwright Test
- Playwright APIRequestContext
- @axe-core/playwright
- GitHub Actions
- Markdown QA documentation

## Test Coverage

- Authentication for admin, technician, and user roles
- Invalid login handling
- Admin ticket lifecycle workflow
- Technician workflow permissions
- User requester-scoped ticket behavior
- Role-based control visibility
- API authentication, validation, ticket CRUD, and permission checks
- Accessibility smoke checks for login and dashboard views

## How to Run

Start the target app first:

```bash
cd ..
npm run dev
```

Then run the QA lab:

```bash
cd Qa-Automation
npm install
npm test
```

Run against a deployed app:

```bash
$env:BASE_URL="https://your-ticketing-app-url.vercel.app"
npm test
```

## Environment Variables

| Variable   | Required | Default                 | Purpose                |
| ---------- | -------- | ----------------------- | ---------------------- |
| `BASE_URL` | No       | `http://localhost:5173` | Target application URL |

## Test Reports

Playwright generates an HTML report after each run:

```bash
npm run report
```

Trace, screenshot, and video artifacts are retained for failing tests.

## CI/CD

The included GitHub Actions workflow installs dependencies, installs Playwright browsers, runs TypeScript checks, runs the test suite, and uploads the Playwright report as an artifact.

For CI against a deployed environment, configure this secret:

```txt
BASE_URL=https://your-ticketing-app-url.vercel.app
```

## Project Structure

```txt
Qa-Automation/
  .github/workflows/ci.yml
  docs/
  fixtures/
  pages/
  tests/
    api/
    e2e/
  utils/
  playwright.config.ts
  package.json
  tsconfig.json
```

## QA Documents

- [Test Strategy](docs/TEST_STRATEGY.md)
- [Test Cases](docs/TEST_CASES.md)
- [Bug Reports](docs/BUG_REPORTS.md)
- [Traceability Matrix](docs/TRACEABILITY_MATRIX.md)

## Skills Demonstrated

- Playwright browser automation
- API automation
- TypeScript test architecture
- Page Object Model
- reusable fixtures and helpers
- role-based permission testing
- accessibility testing
- CI test execution
- QA documentation and traceability

## Resume Bullet

Built a standalone QA automation framework using Playwright and TypeScript to validate login, role-based permissions, ticket lifecycle workflows, API behavior, accessibility checks, and CI-based regression testing for a full-stack IT ticketing application.
