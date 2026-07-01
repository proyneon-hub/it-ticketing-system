# Test Cases

| ID     | Area          | Scenario                                | Steps                                    | Expected Result                                   | Automated? |
| ------ | ------------- | --------------------------------------- | ---------------------------------------- | ------------------------------------------------- | ---------- |
| TC-001 | Auth          | Admin can log in                        | Open app, choose admin demo account      | Admin session and dashboard are visible           | Yes        |
| TC-002 | Auth          | Technician can log in                   | Open app, choose technician demo account | Technician session and dashboard are visible      | Yes        |
| TC-003 | Auth          | User can log in                         | Open app, choose user demo account       | User session and dashboard are visible            | Yes        |
| TC-004 | Auth          | Invalid password fails                  | Submit admin email with bad password     | Error message appears and user remains signed out | Yes        |
| TC-005 | Auth          | Signed-out visitor cannot see dashboard | Open app without token                   | Login form and sign-in panel are visible          | Yes        |
| TC-006 | Admin         | Admin can view all tickets              | Log in as admin and inspect table        | Ticket rows are visible                           | Yes        |
| TC-007 | Admin         | Admin can create ticket                 | Fill create form and submit              | Success message and new ticket appear             | Yes        |
| TC-008 | Admin         | Admin can change priority               | Update first ticket priority             | Ticket updated message appears                    | Yes        |
| TC-009 | Admin         | Admin can change status                 | Update first ticket status               | Ticket updated message appears                    | Yes        |
| TC-010 | Admin         | Admin can change assignee               | Edit assignee and blur field             | Ticket updated message appears                    | Yes        |
| TC-011 | Admin         | Admin can inspect activity              | Open first ticket activity timeline      | Activity timeline appears                         | Yes        |
| TC-012 | Admin         | Admin can delete ticket                 | Delete automation-created ticket         | Ticket deleted message appears                    | Yes        |
| TC-013 | Technician    | Technician can view queue               | Log in as technician                     | Ticket rows are visible                           | Yes        |
| TC-014 | Technician    | Technician can update status            | Change first ticket status               | Ticket updated message appears                    | Yes        |
| TC-015 | Technician    | Technician cannot delete                | Log in as technician                     | Delete buttons are not visible                    | Yes        |
| TC-016 | User          | User can create ticket                  | Log in as user and submit ticket         | Ticket is created under user identity             | Yes        |
| TC-017 | User          | User cannot update workflow             | Log in as user                           | Status controls are disabled                      | Yes        |
| TC-018 | User          | User cannot delete                      | Log in as user                           | Delete buttons are not visible                    | Yes        |
| TC-019 | User          | User sees only own requester data       | Inspect visible rows as user             | Rows contain signed-in user email                 | Yes        |
| TC-020 | API           | Health endpoint succeeds                | GET `/api/health`                        | Response is 200 with service status               | Yes        |
| TC-021 | API           | Login returns token                     | POST valid credentials                   | Response includes token and user                  | Yes        |
| TC-022 | API           | Protected tickets reject missing auth   | GET `/api/tickets` without token         | Response is 401                                   | Yes        |
| TC-023 | API           | Ticket create validates title           | POST missing title                       | Response is 400                                   | Yes        |
| TC-024 | API           | Admin can CRUD ticket                   | Create, patch, list, delete ticket       | Expected 201, 200, 200, 204 responses             | Yes        |
| TC-025 | API           | Technician delete is forbidden          | DELETE as technician                     | Response is 403                                   | Yes        |
| TC-026 | Accessibility | Login accessibility smoke               | Run axe on login page                    | No serious or critical violations                 | Yes        |
| TC-027 | Accessibility | Dashboard accessibility smoke           | Run axe on dashboard page                | No serious or critical violations                 | Yes        |
