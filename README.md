# IT Ticketing System

A production-style service desk application built with **React**, **Vite**, **Node.js**, **Express**, and **MongoDB**. It demonstrates authenticated ticket intake, role-based access, assignment workflow, SLA visibility, API validation, tests, Docker, and CI.

## Portfolio Highlights

- Authentication with signed demo bearer tokens
- Role-based access for `admin`, `technician`, and `user`
- Ticket workflow: `open`, `assigned`, `in-progress`, `resolved`, `closed`
- SLA dashboard with breached and due-soon counts
- Priority model: `urgent`, `high`, `medium`, `low`
- User-scoped ticket visibility for requester accounts
- Admin-only destructive actions
- Seeded demo credentials and realistic ticket data
- Jest + Supertest API tests
- Dockerfile and Docker Compose setup
- GitHub Actions CI for install, test, and build
- API documentation in [docs/API.md](docs/API.md)

## Screenshots

Capture these views after running `npm run seed`:

| View | What to show |
|---|---|
| Admin dashboard | SLA cards, workflow counts, full ticket queue |
| Technician dashboard | Assignment/status controls without delete access |
| User dashboard | User-scoped tickets and disabled workflow controls |

Recommended paths:

```text
docs/screenshots/admin-dashboard.png
docs/screenshots/technician-dashboard.png
docs/screenshots/user-dashboard.png
```

## Demo Credentials

| Role | Email | Password | Permissions |
|---|---|---|---|
| Admin | `admin@demo.local` | `AdminPass123!` | Full queue, update tickets, delete tickets |
| Technician | `tech@demo.local` | `TechPass123!` | Full queue, update workflow and assignment |
| User | `user@demo.local` | `UserPass123!` | Create and view own tickets only |

The app also exposes these accounts in the login strip for quick portfolio demos.

## Tech Stack

| Layer | Tooling |
|---|---|
| Frontend | React 18, Vite |
| Backend | Node.js, Express |
| Database | MongoDB, Mongoose |
| Testing | Jest, Supertest |
| DevOps | Docker, Docker Compose, GitHub Actions, Vercel-ready API functions |

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create environment variables:

```bash
cp .env.example .env
```

3. Set `MONGODB_URI` in `.env`. For local MongoDB:

```env
MONGODB_URI=mongodb://127.0.0.1:27017/it_ticketing
PORT=5000
AUTH_SECRET=replace-with-a-long-random-secret
```

4. Run the app:

```bash
npm run dev
```

Open `http://localhost:5173`.

5. Seed demo tickets:

```bash
npm run seed
```

## Docker

Run the app and MongoDB together:

```bash
docker compose up --build
```

The API runs at `http://localhost:5000`. The production container serves the built frontend assets and API from the same Express process.

## Tests

```bash
npm test
```

The test suite covers signed demo authentication, protected ticket routes, role-protected delete behavior, and dashboard stats response shape.

## API

Full endpoint documentation lives in [docs/API.md](docs/API.md).

Common endpoints:

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/health` | Health check |
| `POST` | `/api/auth/login` | Demo login |
| `GET` | `/api/auth/me` | Current session |
| `GET` | `/api/tickets` | List visible tickets |
| `GET` | `/api/tickets/stats` | SLA/status/priority stats |
| `POST` | `/api/tickets` | Create ticket |
| `PATCH` | `/api/tickets/:id` | Update ticket |
| `DELETE` | `/api/tickets/:id` | Admin-only delete |

## Project Structure

```text
it-ticketing-system/
|-- .github/workflows/ci.yml
|-- api/                         # Vercel API adapters
|-- docs/API.md                  # API documentation
|-- scripts/seed.js              # Demo ticket seeder
|-- src/client/                  # React frontend
|-- src/server/                  # Express API, auth, routes, model
|-- Dockerfile
|-- docker-compose.yml
|-- package.json
|-- server.js
`-- vite.config.mjs
```

## Deployment

This project can deploy to Vercel with the existing `api/` functions and Vite build output.

Required environment variables:

```text
MONGODB_URI
AUTH_SECRET
```

See [DEPLOYMENT.md](DEPLOYMENT.md) for the existing Vercel walkthrough.

## License

MIT
