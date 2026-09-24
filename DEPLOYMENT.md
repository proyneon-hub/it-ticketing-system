# Deployment

The same Express app runs three ways: locally, in Docker, and as Vercel serverless functions. Pick the one you need; all of them use MongoDB.

| Target                            | Best for                                       | Database                             |
| --------------------------------- | ---------------------------------------------- | ------------------------------------ |
| [Docker Compose](#docker-compose) | Running the whole stack on one machine, and CI | Bundled MongoDB container            |
| [Vercel](#vercel)                 | The public demo                                | MongoDB Atlas                        |
| Local development                 | Day-to-day work (see the [README](README.md))  | `npm run dev:db` or your own MongoDB |

## Configuration

| Variable       | Required          | Notes                                                                                                                                                                                                       |
| -------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MONGODB_URI`  | Yes               | Connection string, for example `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/it_ticketing?retryWrites=true&w=majority`                                                                            |
| `AUTH_SECRET`  | Yes in production | A random value of 32+ characters (`openssl rand -base64 48`). In production `server.ts` refuses to start without it, and on Vercel sign-in returns 503 until it is set. `/api/ready` shows `authConfigured` |
| `CORS_ORIGINS` | No                | Only needed if another origin calls the API from a browser                                                                                                                                                  |

The full list is in the [runbook](docs/RUNBOOK.md#environment-variables). Never commit real values; `.env.example` shows the names.

## Docker Compose

```bash
docker compose up --build --wait     # builds the image, starts MongoDB and the app, waits until healthy
docker compose run --rm seed         # optional: load demo tickets
```

Open `http://localhost:5000`. The API docs are at `/api/docs`.

- The image is multi-stage, runs as the unprivileged `node` user, and contains production dependencies only.
- Its `HEALTHCHECK` probes `/api/ready`, so the container is unhealthy while the database is unreachable.
- MongoDB is published to `127.0.0.1` only.
- Compose supplies a demo `AUTH_SECRET`. Set your own for anything shared: `AUTH_SECRET=... docker compose up`.

Stop and remove everything, including data: `docker compose down --volumes`.

### Published image

CI builds the image on every pull request and pushes it to GitHub Container Registry from `main`:

```bash
docker pull ghcr.io/proyneon-hub/it-ticketing-system:latest
```

Tags: `latest` and `sha-<commit>`. Running an older tag is the fastest rollback.

## Vercel

The frontend is built by Vite and served statically; `api/` contains thin adapters that run the same Express app as serverless functions (`api/[...path].js` is the catch-all). The API is TypeScript: `npm run build` compiles it to `dist-server/` and the adapters load that output, exactly as the Docker image does. `vercel.json` holds the build settings.

1. Create a MongoDB Atlas cluster and a database user. In Network Access, allow the deployment. For a demo, "allow from anywhere" is common; restrict it for anything real.
2. In Vercel choose **Add New Project**, import the GitHub repository, and use these settings:

   | Setting          | Value           |
   | ---------------- | --------------- |
   | Framework Preset | Vite            |
   | Build Command    | `npm run build` |
   | Output Directory | `dist`          |

3. Add the environment variables `MONGODB_URI` and `AUTH_SECRET`.
4. Deploy. Pushes to `main` redeploy automatically.

Or with the CLI:

```bash
npm install -g vercel
vercel login
vercel
vercel env add MONGODB_URI
vercel env add AUTH_SECRET
vercel --prod
```

Environment variable changes only take effect after a redeploy.

## Verify a deployment

1. `GET /api/health` returns `{"ok":true,"service":"it-ticketing-system"}`.
2. `GET /api/ready` returns `200` with `"database":"up"` and the deployed `commit`. This is the check that proves the app can reach MongoDB.
3. Open `/api/docs`, or the app itself, and sign in with each demo role.
4. On an environment that is safe to write to, run the [smoke suite](docs/LIVE_SMOKE_TESTING.md) or the manual `Live Smoke` workflow.

The scheduled `Support Ops Scheduled Health Check` workflow runs the Python health and readiness checks daily once the `BASE_URL` secret is set (see [Support-Ops-Automation](Support-Ops-Automation/README.md)).

## GitHub setup

Some features need a one-time switch in the repository settings:

- **Test reports on GitHub Pages:** Settings, Pages, Source: "GitHub Actions". The `Publish Reports` workflow then publishes the Playwright report and coverage to `https://<owner>.github.io/<repo>/` after each push to `main`.
- **Container images:** no setup; the workflow uses the built-in `GITHUB_TOKEN`. Make the package public under the repository's Packages settings if others should pull it.
- **Live smoke against a deployment:** add repository secrets as described in [GITHUB_SECRETS_SETUP.md](docs/GITHUB_SECRETS_SETUP.md).

## Common issues

**The API works locally but not on Vercel.** Confirm `MONGODB_URI` is set under Project Settings, Environment Variables, then redeploy.

**`Database unavailable` or a 503 from `/api/ready`.** Check that the user and password in the URI are right, that the database user exists, and that Atlas Network Access allows the deployment.

**`/api/docs` shows a blank or unstyled page on Vercel.** Swagger UI serves its assets from `node_modules/swagger-ui-dist`; `vercel.json` includes them in the functions with `includeFiles`. If a change to that setting breaks the page, check the function's bundled files in the Vercel deployment details.

**A user reports an error.** Ask for the reference shown under it and follow [Tracing a user-reported error](docs/RUNBOOK.md#tracing-a-user-reported-error).
