# Application Support and DevOps Automation Lab

## Overview

This project demonstrates application-support and DevOps-adjacent automation skills by checking service health, validating authentication, testing API availability, generating status reports, and documenting incident response workflows.

It monitors the IT Ticketing System with lightweight Python commands that can run locally, in CI, or on a schedule against a deployed environment.

## Why This Project Matters

Application support work depends on repeatable checks, clear escalation notes, and fast evidence gathering. This lab turns common support tasks into scripts that an analyst can run before escalating an incident.

## Features

- API health check with response-time threshold validation
- Synthetic login checks for admin, technician, user, and invalid credentials
- Authenticated ticket API validation and protected-route verification
- Markdown status report generation
- Markdown incident report generation
- Runbook and incident-response documentation
- Pytest coverage with mocked HTTP responses
- GitHub Actions CI and scheduled monitoring workflows

## Architecture

```txt
Support-Ops-Automation/
  src/support_ops/        Python support automation package
  tests/                  Fast pytest coverage with mocked requests
  docs/                   Runbooks and sample reports
  reports/                Generated local reports, ignored by git
```

## Setup

```bash
cd Support-Ops-Automation
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
```

Update `.env` when targeting a deployed app. Keep real `.env` values out of git.

## Environment Variables

| Variable                         | Purpose                                                            |
| -------------------------------- | ------------------------------------------------------------------ |
| `BASE_URL`                       | Ticketing app URL, such as `http://localhost:5173` or a Vercel URL |
| `APP_NAME`                       | Display name used in generated reports                             |
| `ENVIRONMENT`                    | Environment label such as `local`, `staging`, or `production`      |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Demo admin credentials for synthetic checks                        |
| `TECH_EMAIL` / `TECH_PASSWORD`   | Demo technician credentials for synthetic checks                   |
| `USER_EMAIL` / `USER_PASSWORD`   | Demo user credentials for synthetic checks                         |
| `LATENCY_THRESHOLD_MS`           | Maximum acceptable API response time                               |
| `REQUEST_TIMEOUT_SECONDS`        | HTTP timeout for support checks                                    |

## Commands

```bash
python -m support_ops.health_check
python -m support_ops.synthetic_login
python -m support_ops.ticket_api_check
python -m support_ops.report_generator
python -m support_ops.incident_generator --severity high --summary "API health check failed"
```

## Sample Reports

See:

- [docs/SAMPLE_STATUS_REPORT.md](docs/SAMPLE_STATUS_REPORT.md)
- [docs/SAMPLE_INCIDENT_REPORT.md](docs/SAMPLE_INCIDENT_REPORT.md)

Generated reports are written to `reports/` and ignored by git.

## GitHub Actions

The lab includes portable workflows under `Support-Ops-Automation/.github/workflows/`. The monorepo also has root workflows that run this lab from the correct working directory.

For scheduled production checks, configure repository secrets:

- `BASE_URL`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `TECH_EMAIL`
- `TECH_PASSWORD`
- `USER_EMAIL`
- `USER_PASSWORD`

## Skills Demonstrated

- Python scripting for support automation
- HTTP API validation with `requests`
- Environment-based configuration
- Synthetic transaction monitoring
- Incident documentation
- Markdown report generation
- CI and scheduled GitHub Actions
- Pytest unit testing with mocked service responses
