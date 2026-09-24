# syntax=docker/dockerfile:1

# Stage 1: build the React frontend. Needs the dev dependencies (Vite), which
# never reach the final image.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.mjs tsconfig.server.json ./
COPY server.ts ./
COPY src ./src
COPY scripts/seed.ts ./scripts/seed.ts
# Builds the React app to dist/ and compiles the API to dist-server/.
RUN npm run build

# Stage 2: production dependencies only, so the runtime image carries no test
# runners, linters or browsers.
FROM node:24-alpine AS prod-deps
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Stage 3: the image that runs. Express serves the API and the built frontend
# from one origin.
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=5000
# Reported by /api/ready so a running container can be traced to a commit.
ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=${GIT_COMMIT}

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --from=build --chown=node:node /app/dist-server ./dist-server
COPY --from=build --chown=node:node /app/dist ./dist

# Never run as root inside the container.
USER node
EXPOSE 5000

# Ready means the app can reach its database, not just that the process is up.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/api/ready" || exit 1

# Source maps make production stack traces point at the TypeScript.
CMD ["node", "--enable-source-maps", "dist-server/server.js"]
