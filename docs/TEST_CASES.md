# Automated Mocked Regression Cases

The cases below run in a real browser against controlled API responses in `tests/e2e-mocked`, in Chromium, Firefox and WebKit. They do not contact a backend or database, which keeps them fast and deterministic.

The mock responses copy the shapes of the real API (for example, sign-in returns the user as `id` while `/auth/me` returns `sub`), so a client that mixes them up fails here. Behaviour that needs a real database, such as role scoping in queries, SLA logic and pagination, is covered by the API integration tests, and the whole stack is covered by the real-stack smoke tests. The full map is in [TEST_PLAN.md](TEST_PLAN.md).

| ID         | Area           | Scenario                             | Preconditions            | Steps                           | Expected Result                                            | Automated                   |
| ---------- | -------------- | ------------------------------------ | ------------------------ | ------------------------------- | ---------------------------------------------------------- | --------------------------- |
| AUTH-001   | Authentication | Valid admin login                    | Mocked app               | Sign in as admin                | Dashboard and delete controls load                         | Yes                         |
| AUTH-002   | Authentication | Valid technician login               | Mocked app               | Sign in as technician           | Dashboard loads                                            | Yes                         |
| AUTH-003   | Authentication | Valid requester login                | Mocked app               | Sign in as requester            | Dashboard loads                                            | Yes                         |
| AUTH-004   | Authentication | Invalid password                     | Mocked app               | Submit an invalid password      | Actionable login error appears                             | Yes                         |
| AUTH-007   | Authentication | Logout                               | Authenticated admin      | Sign out                        | Login view returns                                         | Yes                         |
| ROLE-002   | Permissions    | Technician delete restriction        | Authenticated technician | View dashboard                  | No delete controls appear                                  | Yes                         |
| ROLE-003   | Permissions    | Requester administrative restriction | Authenticated requester  | View dashboard                  | Delete and workflow controls are unavailable               | Yes                         |
| ROLE-004   | Permissions    | Requester ticket scoping             | Authenticated requester  | View dashboard                  | Only requester-owned ticket appears                        | Yes                         |
| ROLE-005   | Permissions    | Requester status restriction         | Authenticated requester  | View dashboard                  | Status control is disabled                                 | Yes, asserted with ROLE-003 |
| TICKET-001 | Lifecycle      | Create and delete ticket             | Authenticated admin      | Create then delete ticket       | Ticket and dashboard total update, then return to baseline | Yes                         |
| TICKET-002 | Validation     | Required title                       | Authenticated admin      | Submit empty title              | Native validation focuses title                            | Yes                         |
| TICKET-003 | Validation     | Required description                 | Authenticated admin      | Submit empty description        | Native validation focuses description                      | Yes                         |
| TICKET-004 | Lifecycle      | Assign technician                    | Authenticated admin      | Update assignee                 | Assignment persists and success message appears            | Yes                         |
| TICKET-005 | Lifecycle      | Update status and activity           | Authenticated technician | Change status and open activity | Success and activity timeline appear                       | Yes                         |
| FILTER-001 | Filtering      | Search match                         | Authenticated admin      | Search for a ticket term        | Matching ticket appears                                    | Yes                         |
| FILTER-002 | Filtering      | Empty search                         | Authenticated admin      | Search unknown term             | Clear empty state appears                                  | Yes                         |
| FILTER-003 | Filtering      | Status filter                        | Authenticated admin      | Filter by assigned              | Only assigned ticket appears                               | Yes                         |
| FILTER-004 | Filtering      | Priority filter                      | Authenticated admin      | Filter by urgent                | Only urgent ticket appears                                 | Yes                         |
| EXPORT-002 | Export         | Requester-scoped CSV                 | Authenticated requester  | Export tickets                  | CSV contains only requester-visible ticket                 | Yes                         |
| ERROR-001  | Error handling | Ticket API failure                   | Mocked 503 response      | Sign in                         | Actionable API error appears                               | Yes                         |
| ERROR-002  | Loading        | Pending ticket request               | Controlled delayed mock  | Sign in, release response       | Loading state appears before ticket list                   | Yes                         |

## Exclusions

- AUTH-005 and AUTH-006 are not separate cases because the current login form delegates blank-input behavior to the mock login error rather than field-level validation.
- AUTH-008 is covered by the application login gate but does not have a dedicated protected-route UI test because the current app has no client-side routing.
- ROLE-001 is asserted as part of AUTH-001. ROLE-006 does not apply because the demo-auth model has no disabled-user state.
- TICKET-006 through TICKET-008 require richer activity, deletion, and counter-specific assertions and are partially covered by the lifecycle suite; they remain candidates for later expansion.
- EXPORT-001 is behaviorally exercised by the shared export UI but does not yet have a dedicated admin-content case.
