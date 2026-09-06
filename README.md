# Erica

[![Build & Push to GHCR](https://github.com/AloraMC/Erica/actions/workflows/docker.yml/badge.svg)](https://github.com/AloraMC/Erica/actions/workflows/docker.yml)

AloraMC's Discord bot **Erica** — moderation and community tools, built with [Sapphire Framework](https://www.sapphirejs.org/) and [Bun](https://bun.sh/).

---

## Prerequisites

| Tool | Version |
|---|---|
| [Bun](https://bun.sh/) | ≥ 1.1 |
| Node.js | Not required — Bun handles everything |

> **Do not use `npm` or `yarn`.** This project uses Bun as both runtime and package manager. Using npm will produce a conflicting `package-lock.json` and break the project.

---

## Setup

### 1. Install dependencies

```bash
bun install
```

### 2. Configure environment variables

Copy `.env.example` to `.env.dev` / `.env.prod` and fill in values (see the example file for the full list):

```env
DISCORD_TOKEN=your_bot_token_here
BOT_OWNER_IDS=your_discord_user_id
DATABASE_URL=mysql://erica:password@localhost:3306/erica
LAVALINK_HOST=localhost
LAVALINK_PORT=3000
LAVALINK_PASSWORD=youshallnotpass
```

- **`DISCORD_TOKEN`** — Bot token from the [Discord Developer Portal](https://discord.com/developers/applications)
- **`BOT_OWNER_IDS`** — Comma-separated owner IDs for admin commands
- **`DATABASE_URL`** — MySQL connection string (`mysql://user:pass@host:3306/dbname`)
- **`LAVALINK_*`** — NodeLink connection (Moonlink client); Compose overrides host to `nodelink`

### 3. Run database migrations

```bash
bunx drizzle-kit migrate
```

This creates `data/erica.db` and applies the schema from `drizzle/`.

### 4. Configure YAML files

#### `config/status.yml`

Status-page service definitions for `/status` / the public status API. Copy from `config/status.example.yml`, then `/status reload` after edits.

### 5. Configure log/mod-log channels

Use these slash commands in your server after the bot starts:

```
/config setlogchannel       — General event logs (joins, leaves, edits, etc.)
/config setmodlogchannel    — Moderation action logs
/config setticketlogchannel — Ticket transcripts
```

### 6. HTTP API Server (opt-in)

The website / Minecraft verification / portal role-sync API is **off by default**. Enable it only when you need those integrations:

```env
BOT_API_ENABLED=true
BOT_API_PORT=3001
BOT_API_SECRET=your_shared_secret
PORTAL_API_URL=https://example.com
```

With `BOT_API_ENABLED=false` (or unset), Discord moderation, tickets, music, etc. work normally; website verify and portal sync simply do not run.

---

## Running the Bot

### Development (auto-restart on file changes)

```bash
bun dev
```

### Production

```bash
bun start
```

The logger outputs **debug** level in development and **info** level in production. `NODE_ENV` is not set automatically — to run in production mode:

```bash
NODE_ENV=production bun start
```

### Docker Compose (bot + NodeLink)

Music uses **Moonlink.js** talking to a **NodeLink** audio server. Production Compose runs both:

```bash
docker compose --env-file .env.prod up -d
```

Ensure `.env.prod` has `LAVALINK_PASSWORD`, and optionally `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` (passed through to NodeLink). The bot container is wired to `LAVALINK_HOST=nodelink` on the internal network.

For local `bun dev`, run NodeLink on `:3000` yourself or point `LAVALINK_HOST` at a remote NodeLink instance.

---

## Project Structure

```
src/
├── index.ts                  # Entry point, client setup
├── commands/
│   ├── config/               # /config (log channels)
│   ├── moderation/           # /ban, /kick, /warn, /mute, /purge, etc.
│   ├── tags/                 # /tag, /tag-reload
│   └── tickets/              # /ticket (panel, reload, add, remove, close)
├── listeners/
│   ├── logging/              # Audit log events (joins, leaves, edits, etc.)
│   ├── tickets/              # Ticket interaction handler
│   └── ready.ts              # Bot ready event
├── lib/
│   ├── components.ts         # CV2 helpers, colours, reply utilities
│   ├── database.ts           # Drizzle DB instance
│   ├── LoggingUtil.ts        # Shared logging helpers
│   ├── ModerationUtil.ts     # Infraction DB helpers
│   ├── TagManager.ts         # JSON tag loader
│   ├── TicketsConfig.ts      # tickets.yml loader (Zod + YAML)
│   └── TicketManager.ts      # Ticket open/close/transcript logic
├── db/
│   └── schema.ts             # Drizzle schema definitions
└── preconditions/            # Sapphire preconditions (e.g. Moderation role check)

config/
├── status.yml                # Status-page services (edit + /status reload)
├── status.example.yml
├── tickets.yml               # Ticket panel + categories (edit + /ticket reload)
└── tickets.example.yml       # Documented example with all question types

drizzle/                      # Auto-generated MySQL migrations
data/                         # Local files (transcripts, etc.; git-ignored)
```

---

## Adding a New Command

1. Create a file under `src/commands/<category>/mycommand.ts`
2. Follow the pattern of an existing command (e.g. [src/commands/moderation/kick.ts](src/commands/moderation/kick.ts))
3. Use `@ApplyOptions<Command.Options>({ name, description })` and `registerApplicationCommands`
4. Use `deferReply({ flags: MessageFlags.Ephemeral })` for ephemeral responses
5. Use helpers from `src/lib/components.ts` for consistent CV2-style output

Sapphire auto-discovers all commands and listeners on startup — no registration step needed.

---

## Adding a New Event Listener

1. Create a file under `src/listeners/<category>/mylistener.ts`
2. Look at [src/listeners/logging/](src/listeners/logging/) for examples
3. Use `@ApplyOptions<Listener.Options>({ event: Events.SomeEvent })`

---

## Database

Schema is defined in `src/db/schema.ts` using [Drizzle ORM](https://orm.drizzle.team/).

After changing the schema, generate a new migration:

```bash
bunx drizzle-kit generate
```

Then apply it:

```bash
bunx drizzle-kit migrate
```

To inspect the database interactively:

```bash
bunx drizzle-kit studio
```

---

## Type Checking

```bash
bun tsc --noEmit
```

Run this before pushing to catch any TypeScript errors.
