# Test Plan

## Project Overview

The IT Ticketing System is a full-stack service desk application with role-based access, ticket lifecycle management, SLA tracking, and demo authentication. This plan defines the manual and automated checks used to verify the main workflows.

## Test Scope

In scope:

- Demo login for admin, technician, and user roles
- Role-based ticket visibility and permissions
- Ticket creation, update, delete, filtering, and SLA display
- Protected API behavior and validation errors
- Dashboard stats and seeded demo data
- Build and CI checks

Out of scope for the current demo:

- Real password reset flows
- Persistent user administration
- Email or notification delivery
- Production identity provider integration

## Test Environment

- Local frontend: `http://localhost:5173`
- Local API: `http://localhost:5000/api`
- Database: local MongoDB or MongoDB Atlas through `MONGODB_URI`
- Browser: Chrome or Edge current stable
- Node.js: 20 or later

## User Roles

| Role       | Purpose            | Expected Access                                    |
| ---------- | ------------------ | -------------------------------------------------- |
| Admin      | Service desk owner | Full ticket queue, update workflow, delete tickets |
| Technician | Support analyst    | Full ticket queue, update workflow and assignment  |
| User       | Requester          | Create and view only their own tickets             |

## Manual Smoke Tests

| ID     | Area            | Test Case                                        |
| ------ | --------------- | ------------------------------------------------ |
| TC-001 | Login           | Admin can log in                                 |
| TC-002 | Login           | Technician can log in                            |
| TC-003 | Login           | User can log in                                  |
| TC-004 | Ticket Creation | User can create ticket                           |
| TC-005 | Role Access     | User sees only their own tickets                 |
| TC-006 | Role Access     | Technician sees full ticket queue                |
| TC-007 | Role Access     | User cannot delete tickets                       |
| TC-008 | Role Access     | Technician cannot delete tickets                 |
| TC-009 | Admin           | Admin can delete ticket                          |
| TC-010 | Workflow        | Ticket can move from open to assigned            |
| TC-011 | Workflow        | Ticket can move to in-progress                   |
| TC-012 | Workflow        | Ticket can move to resolved                      |
| TC-013 | SLA             | SLA dashboard shows breached/due-soon tickets    |
| TC-014 | API             | Protected routes reject unauthenticated requests |
| TC-015 | API             | Invalid ticket payload returns validation error  |

## Regression Tests

- Existing demo credentials continue to work.
- Seeded demo tickets appear after running `npm run seed`.
- Dashboard cards load without API errors.
- Filters do not expose tickets outside the current role scope.
- The production build completes with `npm run build`.

## Role-Based Permission Tests

- Admin can create, update, and delete tickets.
- Technician can update ticket status, priority, and assignee but cannot delete tickets.
- User-created tickets are forced to the signed-in user's name and email.
- Users cannot update workflow fields such as status, assignee, or SLA due date.
- API routes return `401` without a bearer token and `403` for forbidden actions.

## API Validation Tests

- Missing ticket title returns `400`.
- Invalid ticket status returns `400`.
- Invalid priority returns `400`.
- Invalid SLA due date returns `400`.
- Invalid ticket ID format returns `400`.
- Unknown ticket ID returns `404`.

## UI Validation Tests

- Required title field prevents empty ticket creation.
- Email input uses browser email validation where applicable.
- Error alerts are shown when API requests fail.
- Loading and empty states are visible for ticket lists.
- Disabled controls communicate role restrictions.

## Edge Cases

- Database unavailable during ticket loading.
- Expired or malformed bearer token.
- Empty search result set.
- Assigned status with no assignee.
- Closed or resolved tickets with overdue SLA dates.
- Long ticket descriptions near the model limit.

## Acceptance Criteria

- `npm test` passes.
- `npm run format:check` passes.
- `npm run build` passes.
- Admin, technician, and user demo workflows function locally.
- No role can access or mutate data outside its expected permission boundary.
