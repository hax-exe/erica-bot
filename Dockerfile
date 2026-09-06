# ── Deps stage ────────────────────────────────────────────────────────────────
FROM oven/bun:alpine AS deps
WORKDIR /app

COPY package.json bun.lock* ./
RUN NODE_ENV=production bun install --frozen-lockfile

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM oven/bun:alpine AS runner
WORKDIR /app

# Install fonts for Canvas / Skia to correctly render unicode and emojis
RUN apk add --no-cache fontconfig ttf-dejavu font-noto font-noto-emoji font-noto-cjk ttf-liberation ttf-freefont \
    && fc-cache -f

RUN addgroup -S -g 1001 erica && adduser -S -u 1001 -G erica erica

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src/ ./src/
COPY assets/ ./assets/
COPY drizzle/ ./drizzle/
COPY drizzle.config.ts ./
COPY tsconfig.json ./
COPY config/ ./config/
COPY scripts/ ./scripts/

RUN mkdir -p /app/data && chown -R erica:erica /app

USER erica

ENV NODE_ENV=production
# Requires DATABASE_URL=mysql://user:pass@host:3306/dbname
# /app/data is still used for ticket transcripts and other local files.

CMD ["sh", "-c", "bun src/migrate.ts && bun src/index.ts"]
