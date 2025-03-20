FROM oven/bun:1 as builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./
# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Build the application
RUN bun run build

# Runtime stage
FROM oven/bun:1-slim

WORKDIR /app

# Copy from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules

# Install PostgreSQL client for health checks
RUN apt-get update && apt-get install -y postgresql-client && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Use non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 bunjs && \
    chown -R bunjs:nodejs /app

USER bunjs

# Define health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD pg_isready -h $POSTGRES_HOST -p $POSTGRES_PORT -U $POSTGRES_USER || exit 1

# Start the agent CLI
CMD ["bun", "dist/src/agent/cli.js", "start", "--pool", "$COMET_POOL_ADDRESS", "--strategy", "$COMET_STRATEGY", "--auto-rebalance", "$COMET_AUTO_REBALANCE"]