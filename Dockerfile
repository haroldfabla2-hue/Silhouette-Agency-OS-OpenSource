# =============================================================================
# MULTI-STAGE DOCKERFILE FOR SILHOUETTE AGENCY OS
# Stage 1: Install dependencies
# Stage 2: Production image (no devDependencies)
# =============================================================================

# --- Stage 1: Build ---
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules (better-sqlite3, etc.)
RUN apk add --no-cache python3 make g++

# Copy package files first (layer caching)
COPY package.json package-lock.json ./

# Install ALL dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build frontend
RUN npm run build

# --- Stage 2: Production ---
FROM node:20-alpine AS production

WORKDIR /app

# Install runtime dependencies for native modules
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --omit=dev && npm cache clean --force

# Copy built frontend from builder
COPY --from=builder /app/dist ./dist

# Copy server source (TypeScript executed via tsx at runtime)
COPY server/ ./server/
COPY services/ ./services/
COPY types.ts ./
COPY types/ ./types/
COPY constants.ts ./
COPY constants/ ./constants/
COPY universalprompts/ ./universalprompts/
COPY silhouette.config.json ./

# Create data directories
RUN mkdir -p data uploads

# Expose API port
EXPOSE 3005

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:3005/v1/system/status || exit 1

# Start server
CMD ["node", "--import", "tsx/esm", "server/index.ts"]
