# ─────────────────────────────────────────────────────────────
# Silhouette Agency OS - Production Dockerfile
# Multi-stage optimized build for Node.js
# ─────────────────────────────────────────────────────────────

# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

# Only copy package files first for optimized layer caching
COPY package*.json ./
RUN npm ci

# Copy full source and tsconfig
COPY . .

# Build frontend and explicit executable server entry; neither is a runtime health check.
RUN npm run build && npx vite build --config vite.server.config.ts

# Stage 2: Production Runtime
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
# Immutable SQL assets must not live below the writable /app/db volume.
ENV SILHOUETTE_MIGRATIONS_DIR=/app/migrations/sqlite

# [ESCAPE HATCH] Install Docker CLI to allow container to control the Host's Docker Daemon
RUN apk add --no-cache docker-cli

# Re-install only production dependencies to save space
COPY package*.json ./
RUN npm ci --only=production

# Copy built outputs from the builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/db/migrations/sqlite ./migrations/sqlite

# Expose API & WS port
EXPOSE 3005

# Healthcheck for the runtime Container (hits pre-auth /health endpoint)
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3005/health || exit 1

# Start the Node.js server
CMD ["node", "dist/server/index.js"]
