# ─────────────────────────────────────────────────────────────
# Silhouette Agency OS - Production Dockerfile
# Multi-stage optimized build for Node.js
# ─────────────────────────────────────────────────────────────

# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

# Only copy package files first for optimized layer caching
COPY package*.json ./
RUN npm ci

# Copy full source and tsconfig
COPY . .

# Build TypeScript to Javascript (assuming there is a build script)
RUN npm run build

# Stage 2: Production Runtime
FROM node:20-alpine AS runner

WORKDIR /usr/src/app

ENV NODE_ENV=production

# Re-install only production dependencies to save space
COPY package*.json ./
RUN npm ci --only=production

# Copy built outputs from the builder stage
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/package.json ./package.json

# Expose API & WS port
EXPOSE 3005

# Healthcheck for the runtime Container (hits pre-auth /health endpoint)
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3005/health || exit 1

# Start the Node.js server
CMD ["node", "dist/server/index.js"]
