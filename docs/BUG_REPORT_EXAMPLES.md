# Bug Report Examples

## BUG-001: User Can Access Unauthorized Ticket

- Severity: High
- Priority: High
- Environment: Local Chrome / Vercel deployment
- Steps to Reproduce:
  1. Log in as `user@demo.local`.
  2. Capture the ID of a ticket created by another requester.
  3. Request `/api/tickets/:id` directly with the user's bearer token.
- Expected: API returns `404` or `403` and the ticket is not exposed.
- Actual: User can view ticket details for another requester.
- Evidence: Network response includes requester name, email, and ticket description.
- Suggested Fix: Apply requester scope to single-ticket reads and add an API regression test.

## BUG-002: Ticket Form Allows Empty Title

- Severity: Medium
- Priority: High
- Environment: Local Chrome
- Steps to Reproduce:
  1. Log in as any role.
  2. Submit a ticket with a blank title and valid description.
- Expected: UI prevents submission and API returns a clear validation message.
- Actual: Ticket is created with an empty or whitespace-only title.
- Evidence: New row appears in the dashboard without a visible title.
- Suggested Fix: Trim title input on the API and enforce the required field in the UI.

## BUG-003: Status Can Move to Assigned Without Assignee

- Severity: Medium
- Priority: Medium
- Environment: Local Chrome / API client
- Steps to Reproduce:
  1. Log in as technician.
  2. Open an unassigned ticket.
  3. Change status from `open` to `assigned`.
- Expected: API rejects the update unless an assignee is present.
- Actual: Ticket enters `assigned` state while assignee remains `Unassigned`.
- Evidence: Dashboard row shows `Assigned` and `Unassigned`.
- Suggested Fix: Validate workflow transition in the PATCH route and test it.

## BUG-004: SLA Dashboard Count Mismatch

- Severity: Medium
- Priority: Medium
- Environment: Seeded local database
- Steps to Reproduce:
  1. Run `npm run seed`.
  2. Log in as admin.
  3. Compare breached SLA card against manually filtered breached tickets.
- Expected: Dashboard breached count matches visible unresolved overdue tickets.
- Actual: Card count differs from the ticket list count.
- Evidence: SLA card shows `2`, filtered table shows `1`.
- Suggested Fix: Reuse the same terminal status and due date logic for stats and list filters.

## BUG-005: Vercel Deployment Missing Environment Variable

- Severity: High
- Priority: High
- Environment: Vercel production deployment
- Steps to Reproduce:
  1. Deploy the project without `MONGODB_URI`.
  2. Log in and load the ticket dashboard.
- Expected: App shows a configuration error with deployment guidance.
- Actual: API returns a generic `500 Internal Server Error`.
- Evidence: Vercel function logs show missing MongoDB connection string.
- Suggested Fix: Validate required environment variables and return a `503` with operator guidance.
