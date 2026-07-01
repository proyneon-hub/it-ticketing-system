# Incident Response Guide

## Severity Levels

| Severity | Description                                                       | Response Target                   |
| -------- | ----------------------------------------------------------------- | --------------------------------- |
| Critical | The app is unavailable or core ticketing workflows are blocked.   | Immediate response and escalation |
| High     | A major workflow is degraded, such as login or ticket API access. | Same business day response        |
| Medium   | A non-critical feature is impaired or slow.                       | Next business day response        |
| Low      | Cosmetic issue, documentation gap, or minor support request.      | Planned backlog                   |

## Incident Lifecycle

1. Detect the issue through monitoring, user report, or scheduled checks.
2. Confirm impact with health, login, and ticket API checks.
3. Open an incident report with severity, summary, and symptoms.
4. Follow the runbook for initial triage.
5. Escalate with evidence if the issue requires application-owner action.
6. Validate recovery with the same checks that detected the issue.
7. Complete a post-incident review.

## Communication Template

```txt
Status: Investigating
Service: IT Ticketing System
Impact: Users may be unable to complete ticketing workflows.
Current Action: Running health, login, and ticket API checks.
Next Update: Within 30 minutes or sooner if status changes.
```

## Sample Timeline

| Time      | Event                                             |
| --------- | ------------------------------------------------- |
| 09:00 UTC | Scheduled health check fails.                     |
| 09:05 UTC | Support confirms API health endpoint returns 503. |
| 09:10 UTC | Incident report created and owner notified.       |
| 09:25 UTC | Environment variable issue identified.            |
| 09:40 UTC | Service redeployed and checks pass.               |

## Post-Incident Review Template

- Summary:
- Customer impact:
- Root cause:
- Detection source:
- What worked well:
- What needs improvement:
- Follow-up actions:
- Owner:
- Due date:
