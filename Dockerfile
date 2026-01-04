# Docker configuration for production deployment
# Using Debian-slim instead of Alpine for @napi-rs/canvas compatibility
FROM node:20-slim AS base

# Install runtime dependencies for @napi-rs/canvas
RUN apt-get update && apt-get install -y --no-install-recommends \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libjpeg62-turbo \
    libgif7 \
    librsvg2-2 \
    libpixman-1-0 \
    fontconfig \
    fonts-dejavu-core \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f -v

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Install build dependencies for native modules
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg62-turbo-dev \
    libgif-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json package-lock.json ./
RUN npm ci --only=production

# Production stage
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 bot

# Copy production dependencies
COPY --from=deps --chown=bot:nodejs /app/node_modules ./node_modules

# Copy pre-built dist from CI artifact (passed via build context)
COPY --chown=bot:nodejs dist ./dist
COPY --chown=bot:nodejs package.json ./

USER bot

CMD ["node", "dist/index.js"]

