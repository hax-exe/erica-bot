# Docker configuration for production deployment
FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./
RUN npm ci --only=production

# Production stage
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 bot

# Copy production dependencies
COPY --from=deps --chown=bot:nodejs /app/node_modules ./node_modules

# Copy pre-built dist from CI artifact (passed via build context)
COPY --chown=bot:nodejs dist ./dist
COPY --chown=bot:nodejs package.json ./

USER bot

CMD ["node", "dist/index.js"]
