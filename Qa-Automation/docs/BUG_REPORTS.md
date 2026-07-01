# Bug Reports

## BUG-001: Technician can see admin-only delete button

- Severity: High
- Priority: High
- Environment: Local and deployed ticket dashboard
- Steps to Reproduce:
  1. Log in as `tech@demo.local`.
  2. Open the ticket dashboard.
  3. Inspect row actions for any ticket.
- Expected Result: Technician cannot see or use delete controls.
- Actual Result: Delete button appears for technician.
- Evidence: Screenshot or Playwright trace showing `ticket-delete-button`.
- Suggested Fix: Render delete controls only when `user.role === "admin"` and keep API delete protected by admin role.

## BUG-002: User can see tickets created by another requester

- Severity: Critical
- Priority: High
- Environment: Deployed ticket dashboard
- Steps to Reproduce:
  1. Log in as `user@demo.local`.
  2. Open ticket dashboard.
  3. Inspect requester email values in visible rows.
- Expected Result: Every visible ticket belongs to `user@demo.local`.
- Actual Result: A ticket from a different requester appears.
- Evidence: Table row screenshot and network response from `/api/tickets`.
- Suggested Fix: Apply requester email scoping in the API for user role before returning tickets.

## BUG-003: Ticket creation accepts blank title

- Severity: Medium
- Priority: High
- Environment: API
- Steps to Reproduce:
  1. Log in as admin.
  2. POST `/api/tickets` with only a description.
- Expected Result: API returns `400` with a validation message.
- Actual Result: Ticket is created without a title.
- Evidence: API response body and created ticket ID.
- Suggested Fix: Validate title server-side before creating the ticket.

## BUG-004: Invalid login does not show feedback

- Severity: Medium
- Priority: Medium
- Environment: Login page
- Steps to Reproduce:
  1. Enter valid admin email.
  2. Enter incorrect password.
  3. Submit login form.
- Expected Result: Login page shows a clear invalid credentials message.
- Actual Result: Form remains on screen without feedback.
- Evidence: Playwright trace and screenshot after submit.
- Suggested Fix: Surface API error response in an accessible alert region.

## BUG-005: Closed ticket still counted as SLA breached

- Severity: Medium
- Priority: Medium
- Environment: Dashboard stats
- Steps to Reproduce:
  1. Create overdue ticket.
  2. Change status to closed.
  3. Refresh dashboard stats.
- Expected Result: Closed ticket is excluded from active SLA breach counts.
- Actual Result: Closed ticket remains counted as breached.
- Evidence: Before/after dashboard screenshots and API stats response.
- Suggested Fix: Exclude resolved and closed tickets from SLA breach queries.
