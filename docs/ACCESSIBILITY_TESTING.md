# Accessibility Testing

## Automated Scope

`npm run test:a11y` runs Axe against the mocked login page, authenticated dashboard, and ticket form. The scanner evaluates WCAG 2.0/2.1 A and AA rules and fails only for serious or critical findings.

The tests use deterministic mocked API responses so accessibility failures can be reproduced without a live database.

## Manual Scope

Automation does not replace manual checks for:

- Keyboard-only workflows and focus order.
- Screen-reader clarity and announcement quality.
- Visual zoom, reflow, and responsive behavior.
- Cognitive usability and the quality of alternative text.
- Information conveyed by color alone.

Use [ACCESSIBILITY_CHECKLIST.md](ACCESSIBILITY_CHECKLIST.md) for those checks.

## Triage

- Fix serious and critical Axe findings in the affected UI where practical.
- Do not broadly disable Axe rules to obtain a passing result.
- If a temporary exclusion becomes necessary, document the affected selector, rationale, and tracking issue in this file.

## Run

```bash
npm run test:a11y
```
