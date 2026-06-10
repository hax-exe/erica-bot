# ──────────────────────────────────────────────
# Stage 1 — Install dependencies
# ──────────────────────────────────────────────
FROM oven/bun:1 AS deps

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production=false

# ──────────────────────────────────────────────
# Stage 2 — Build TypeScript
# ──────────────────────────────────────────────
FROM oven/bun:1 AS build

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json tsup.config.* ./
COPY src ./src

RUN bun run build

# Prune dev dependencies for production
RUN bun install --frozen-lockfile --production

# ──────────────────────────────────────────────
# Stage 3 — Production runtime
# ──────────────────────────────────────────────
FROM oven/bun:1-slim AS production

WORKDIR /app

ENV NODE_ENV=production

# Create non-root user for security
RUN addgroup --system --gid 1001 erica && \
    adduser --system --uid 1001 --ingroup erica erica

COPY --from=build --chown=erica:erica /app/dist ./dist
COPY --from=build --chown=erica:erica /app/node_modules ./node_modules
COPY --from=build --chown=erica:erica /app/package.json ./package.json

# Copy Drizzle migrations if they exist
COPY --from=build --chown=erica:erica /app/drizzle ./drizzle

# Copy i18n language files
COPY --from=build --chown=erica:erica /app/src/languages ./src/languages

USER erica

CMD ["bun", "dist/index.js"]
