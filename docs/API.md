# API Documentation

Base URL: `/api`

## Authentication

Demo sessions use a signed bearer token returned by `POST /auth/login`.

| Role       | Email              | Password        |
| ---------- | ------------------ | --------------- |
| Admin      | `admin@demo.local` | `AdminPass123!` |
| Technician | `tech@demo.local`  | `TechPass123!`  |
| User       | `user@demo.local`  | `UserPass123!`  |

Send authenticated requests with:

```http
Authorization: Bearer <token>
```

## Endpoints

| Method | Endpoint           | Auth         | Purpose                                            |
| ------ | ------------------ | ------------ | -------------------------------------------------- |
| GET    | `/health`          | Public       | Deployment health check                            |
| POST   | `/auth/login`      | Public       | Sign in with demo credentials                      |
| GET    | `/auth/me`         | Bearer token | Return the current session                         |
| GET    | `/auth/demo-users` | Public       | List seeded demo accounts                          |
| GET    | `/tickets`         | Bearer token | List tickets with filters, sorting, and pagination |
| GET    | `/tickets/export`  | Bearer token | Export visible tickets as CSV                      |
| GET    | `/tickets/stats`   | Bearer token | Dashboard, priority, and SLA stats                 |
| GET    | `/tickets/:id`     | Bearer token | Fetch one visible ticket                           |
| POST   | `/tickets`         | Bearer token | Create a ticket                                    |
| PATCH  | `/tickets/:id`     | Bearer token | Update ticket fields                               |
| DELETE | `/tickets/:id`     | Admin only   | Delete a ticket                                    |

## Ticket Workflow

Supported statuses:

```text
open -> assigned -> in-progress -> resolved -> closed
```

Supported priorities and default SLA windows:

| Priority | Default SLA |
| -------- | ----------- |
| `urgent` | 4 hours     |
| `high`   | 24 hours    |
| `medium` | 48 hours    |
| `low`    | 72 hours    |

New tickets receive a human-friendly `ticketNumber` such as `TKT-0001`. MongoDB `_id` values are still used internally for route parameters.

## List Tickets

`GET /tickets` supports:

| Query        | Description                                                                                         |
| ------------ | --------------------------------------------------------------------------------------------------- |
| `page`       | Page number, minimum `1`                                                                            |
| `limit`      | Page size, `1` to `100`                                                                             |
| `sortBy`     | One of `ticketNumber`, `title`, `status`, `priority`, `assignee`, `dueAt`, `createdAt`, `updatedAt` |
| `sortOrder`  | `asc` or `desc`                                                                                     |
| `status`     | `open`, `assigned`, `in-progress`, `resolved`, or `closed`                                          |
| `priority`   | `low`, `medium`, `high`, or `urgent`                                                                |
| `assignedTo` | Case-insensitive assignee filter                                                                    |
| `search`     | Searches ticket number, title, description, requester, assignee, and category                       |
| `sla`        | `breached` or `due-soon`                                                                            |

Example:

```http
GET /api/tickets?page=1&limit=10&sortBy=createdAt&sortOrder=desc&status=open&priority=high
```

Response shape:

```json
{
  "tickets": [],
  "data": [],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 27,
    "totalPages": 3
  }
}
```

The `tickets` property is kept for compatibility; new clients can use `data`.

## CSV Export

`GET /tickets/export` returns a CSV file for the tickets visible to the current role. Admins and technicians export the full queue. Users export only their own scoped tickets.

Recommended columns:

```text
Ticket ID, Title, Status, Priority, Requester, Assigned To, Created At, Updated At, SLA Due At, SLA Breached
```

## Activity Timeline

Ticket responses include an `activity` array. Workflow updates create structured entries such as:

```json
{
  "action": "status_changed",
  "from": "assigned",
  "to": "in-progress",
  "actorName": "Theo Technician",
  "actorRole": "technician",
  "actorEmail": "tech@demo.local",
  "createdAt": "2026-07-01T12:00:00.000Z"
}
```

## Example

```bash
TOKEN=$(curl -s http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@demo.local","password":"AdminPass123!"}' | jq -r .token)

curl http://localhost:5000/api/tickets/stats \
  -H "Authorization: Bearer $TOKEN"
```
