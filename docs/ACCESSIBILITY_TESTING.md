# Accessibility Testing

## Automated scope

`npm run test:a11y` runs Axe against the mocked login page, authenticated dashboard and ticket form, in Chromium, Firefox and WebKit. The scanner evaluates WCAG 2.0/2.1 A and AA rules and fails for serious or critical findings.

The tests use deterministic mocked API responses so an accessibility failure can be reproduced without a database.

Built into the UI for assistive technology:

- Errors use `role="alert"` and success messages use `role="status"`, so they are announced when they appear.
- The activity toggle exposes `aria-expanded`.
- Every table control has a ticket-specific accessible name, such as `Status for TKT-0001`.
- Filters expose their names with `aria-label`; the login fields have visually hidden labels.

## Manual checklist

Automation does not replace these. Repeat them after significant UI changes.

**Keyboard**

- Tab reaches the login fields, demo account buttons, ticket form inputs, filters, export, pagination and table controls, in a sensible order.
- Enter submits the login and ticket forms.
- Focus is visible on every input, select and button.

**Labels and headings**

- Every form field has an accessible label, including the ticket title, description, requester, priority, category and assignee.
- The page has a single `h1`, sections use `h2`, and the activity timeline uses a nested heading inside the expanded row.

**Colour and contrast**

- Status, priority, SLA, success and error colours stay readable on their backgrounds.
- Nothing relies on colour alone: status and SLA state are also shown as text.

**Errors and screen readers**

- API failures appear in a visible alert and are announced. Validation messages are short and actionable.
- Buttons use visible text labels rather than icons alone.

**Zoom and reflow**

- The page stays usable at 200% zoom and at narrow widths.

## Triage

- Fix serious and critical Axe findings in the UI where practical.
- Do not broadly disable Axe rules to obtain a passing run.
- If a temporary exclusion is unavoidable, record the selector, the reason and a tracking issue in this file.

## Run

```bash
npm run test:a11y
```
