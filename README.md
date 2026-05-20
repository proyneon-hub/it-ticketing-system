# IT Ticketing System

A full-stack IT ticketing system built with **Node.js**, **Express**, **MongoDB**, **React**, and **Vite**. It is ready to push to GitHub and deploy on Vercel.

## Features

- Create support tickets
- Update ticket status: `open`, `in-progress`, `resolved`, `closed`
- Assign ticket priority: `low`, `medium`, `high`, `urgent`
- Assign tickets to a technician/team
- Dashboard summary cards
- Search and filter by status/priority
- Delete tickets
- MongoDB persistence with Mongoose
- Vercel-ready API functions

## Tech Stack

| Layer | Tooling |
|---|---|
| Frontend | React + Vite |
| Backend | Node.js + Express |
| Database | MongoDB Atlas / local MongoDB |
| Deployment | Vercel |

## Project Structure

```text
it-ticketing-system/
├── api/
│   ├── index.js              # Vercel API entry
│   └── [...path].js          # Vercel catch-all API entry
├── scripts/
│   └── seed.js               # Optional sample data seeder
├── src/
│   ├── client/               # React frontend
│   └── server/               # Express API, DB, routes, model
├── .env.example
├── package.json
├── server.js                 # Local Express server
├── vercel.json
└── vite.config.js
```

## Local Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create environment file

```bash
cp .env.example .env
```

Add your MongoDB connection string:

```env
MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/it_ticketing?retryWrites=true&w=majority
PORT=5000
NODE_ENV=development
```

### 3. Run the app locally

```bash
npm run dev
```

Open:

```text
http://localhost:5173
```

The React frontend runs on port `5173`. The Express API runs on port `5000`, and Vite proxies `/api` requests to it.

### 4. Optional: add sample tickets

```bash
npm run seed
```


## Quick Deployment for Your Accounts

1. Create an empty GitHub repository named `it-ticketing-system` under `proyneon-hub`.
2. From this project folder, run:

```bash
git branch -M main
git remote set-url origin https://github.com/proyneon-hub/it-ticketing-system.git
git push -u origin main
```

3. In Vercel, import `proyneon-hub/it-ticketing-system`.
4. Add `MONGODB_URI` in Vercel Environment Variables.
5. Deploy.

See `DEPLOYMENT.md` for the full step-by-step guide.

## API Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/tickets` | List tickets with optional `status`, `priority`, `search` filters |
| GET | `/api/tickets/stats` | Dashboard statistics |
| GET | `/api/tickets/:id` | Get one ticket |
| POST | `/api/tickets` | Create a ticket |
| PATCH | `/api/tickets/:id` | Update status, priority, assignee, or other fields |
| DELETE | `/api/tickets/:id` | Delete a ticket |

Example create-ticket request:

```bash
curl -X POST http://localhost:5000/api/tickets \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Laptop cannot connect to Wi-Fi",
    "description": "Device drops from Wi-Fi every few minutes.",
    "requesterName": "Avery Johnson",
    "requesterEmail": "avery@example.com",
    "priority": "high",
    "assignee": "Network Support"
  }'
```

## Push to GitHub

This project has been tailored for your GitHub profile: `https://github.com/proyneon-hub`. The recommended repository name is `it-ticketing-system`.

After unzipping this project:

```bash
cd it-ticketing-system
git status
git branch -M main
git remote set-url origin https://github.com/proyneon-hub/it-ticketing-system.git
git push -u origin main
```

If the remote repo already has content, use a new empty repo or pull/merge first.

## Deploy to Vercel

This project is ready to deploy under your Vercel account/team path: `https://vercel.com/pramits-projects-ce654619`.

### Option A: Import from GitHub

1. Push this repository to GitHub.
2. Go to Vercel and choose **Add New Project**.
3. Import the GitHub repository.
4. Add the environment variable:

```text
MONGODB_URI = your MongoDB Atlas connection string
```

5. Deploy.

### Option B: Vercel CLI

```bash
npm install -g vercel
vercel login
vercel
vercel env add MONGODB_URI
vercel --prod
```

## MongoDB Atlas Notes

Use MongoDB Atlas for deployed hosting. For a simple portfolio deployment, the Vercel MongoDB Atlas integration can configure `MONGODB_URI` automatically. If you set up Atlas manually, create a database user, add your connection string as `MONGODB_URI`, and configure network access according to your Atlas/Vercel setup.

## Recommended Next Improvements

- Authentication for admin/technician users
- Role-based permissions
- Ticket comments/activity history
- File attachments
- Email notifications
- SLA due dates
- Pagination for large ticket volumes
- PostgreSQL version using Prisma or Drizzle

## License

MIT
