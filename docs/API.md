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

| Method | Endpoint           | Auth         | Purpose                            |
| ------ | ------------------ | ------------ | ---------------------------------- |
| GET    | `/health`          | Public       | Deployment health check            |
| POST   | `/auth/login`      | Public       | Sign in with demo credentials      |
| GET    | `/auth/me`         | Bearer token | Return the current session         |
| GET    | `/auth/demo-users` | Public       | List seeded demo accounts          |
| GET    | `/tickets`         | Bearer token | List tickets with optional filters |
| GET    | `/tickets/stats`   | Bearer token | Dashboard, priority, and SLA stats |
| GET    | `/tickets/:id`     | Bearer token | Fetch one visible ticket           |
| POST   | `/tickets`         | Bearer token | Create a ticket                    |
| PATCH  | `/tickets/:id`     | Bearer token | Update ticket fields               |
| DELETE | `/tickets/:id`     | Admin only   | Delete a ticket                    |

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

## Example

```bash
TOKEN=$(curl -s http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@demo.local","password":"AdminPass123!"}' | jq -r .token)

curl http://localhost:5000/api/tickets/stats \
  -H "Authorization: Bearer $TOKEN"
```
