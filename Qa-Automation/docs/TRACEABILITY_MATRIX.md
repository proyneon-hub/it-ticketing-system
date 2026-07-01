# Traceability Matrix

| Requirement                                 | UI Test                                 | API Test                            | Status       |
| ------------------------------------------- | --------------------------------------- | ----------------------------------- | ------------ |
| Admin can log in                            | `tests/e2e/auth.spec.ts`                | `tests/api/auth.api.spec.ts`        | Automated    |
| Technician can log in                       | `tests/e2e/auth.spec.ts`                | `tests/api/auth.api.spec.ts`        | Automated    |
| User can log in                             | `tests/e2e/auth.spec.ts`                | `tests/api/auth.api.spec.ts`        | Automated    |
| Invalid login fails                         | `tests/e2e/auth.spec.ts`                | `tests/api/auth.api.spec.ts`        | Automated    |
| Signed-out visitor cannot access dashboard  | `tests/e2e/auth.spec.ts`                | `tests/api/auth.api.spec.ts`        | Automated    |
| Admin can create ticket                     | `tests/e2e/admin-workflow.spec.ts`      | `tests/api/tickets.api.spec.ts`     | Automated    |
| Admin can update ticket status              | `tests/e2e/admin-workflow.spec.ts`      | `tests/api/tickets.api.spec.ts`     | Automated    |
| Admin can update priority                   | `tests/e2e/admin-workflow.spec.ts`      | `tests/api/tickets.api.spec.ts`     | Automated    |
| Admin can update assignee                   | `tests/e2e/admin-workflow.spec.ts`      | Planned expanded API assertion      | Automated UI |
| Admin can delete ticket                     | `tests/e2e/admin-workflow.spec.ts`      | `tests/api/tickets.api.spec.ts`     | Automated    |
| Technician can update status                | `tests/e2e/technician-workflow.spec.ts` | Planned expanded API assertion      | Automated UI |
| Technician cannot delete ticket             | `tests/e2e/technician-workflow.spec.ts` | `tests/api/permissions.api.spec.ts` | Automated    |
| User can create ticket                      | `tests/e2e/user-workflow.spec.ts`       | `tests/api/permissions.api.spec.ts` | Automated    |
| User sees only own tickets                  | `tests/e2e/permissions.spec.ts`         | `tests/api/permissions.api.spec.ts` | Automated    |
| User cannot delete ticket                   | `tests/e2e/user-workflow.spec.ts`       | Planned expanded API assertion      | Automated UI |
| User cannot update workflow                 | `tests/e2e/user-workflow.spec.ts`       | Planned expanded API assertion      | Automated UI |
| Health endpoint returns success             | Not applicable                          | `tests/api/auth.api.spec.ts`        | Automated    |
| Protected ticket route rejects missing auth | Not applicable                          | `tests/api/tickets.api.spec.ts`     | Automated    |
| Ticket create validates title               | Browser required field covers UI        | `tests/api/tickets.api.spec.ts`     | Automated    |
| Login page accessibility                    | `tests/e2e/accessibility.spec.ts`       | Not applicable                      | Automated    |
| Dashboard accessibility                     | `tests/e2e/accessibility.spec.ts`       | Not applicable                      | Automated    |
