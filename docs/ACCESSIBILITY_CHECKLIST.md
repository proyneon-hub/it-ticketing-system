# Accessibility Checklist

## Keyboard Test

- Tab reaches login fields, demo account buttons, ticket form inputs, filters, export, pagination, and table controls.
- Enter submits login and ticket creation forms.
- Focus states are visible on inputs, selects, and buttons.

## Form Label Test

- Login email and password fields have accessible labels.
- Ticket title, description, requester, priority, category, and assignee fields are labeled.
- Filter controls expose accessible names through labels or `aria-label`.

## Heading Structure Test

- Page has a single `h1`.
- Main sections use `h2`.
- Activity timeline uses a nested heading inside the expanded ticket row.

## Contrast Review

- Status, priority, SLA, success, and error colors should remain readable against their backgrounds.
- Do not rely on color alone; status and SLA text labels are visible.

## Error Message Review

- API failures appear in a visible alert area.
- Validation messages should be short and actionable.

## Screen Reader Naming

- Icon-free buttons use visible text labels.
- Dynamic table controls include ticket-specific accessible names where practical.

## Regression Notes

Run the Playwright role-permission tests after UI changes to verify disabled workflow controls and admin-only delete controls still behave as expected.
