# Erica

[![Build & Push to GHCR](https://github.com/hax-exe/erica-bot/actions/workflows/docker.yml/badge.svg)](https://github.com/hax-exe/erica-bot/actions/workflows/docker.yml)

**Erica** — a Discord moderation and community bot, built with [Sapphire Framework](https://www.sapphirejs.org/) and [Bun](https://bun.sh/).

---

## Prerequisites

| Tool | Version |
|---|---|
| [Bun](https://bun.sh/) | ≥ 1.3 |
| Node.js | Not required — Bun handles everything |

> **Do not use `npm` or `yarn`.** This project uses Bun as both runtime and package manager. Using npm will produce a conflicting `package-lock.json` and break the project.

---

## Setup

### 1. Install dependencies

```bash
bun install
```

### 2. Configure environment variables

Copy `.env.example` to `.env` and fill in values (see the example file for the full list):

```env
DISCORD_TOKEN=your_bot_token_here
BOT_OWNER_IDS=your_discord_user_id
DATABASE_URL=mysql://erica:password@localhost:3306/erica
LAVALINK_HOST=localhost
LAVALINK_PORT=3000
LAVALINK_PASSWORD=youshallnotpass
```

- **`DISCORD_TOKEN`** — Bot token from the [Discord Developer Portal](https://discord.com/developers/applications) (required; the bot exits at startup without it)
- **`BOT_OWNER_IDS`** — Comma-separated owner IDs for admin commands
- **`DATABASE_URL`** — MySQL connection string (`mysql://user:pass@host:3306/dbname`)
- **`LAVALINK_*`** — NodeLink connection (Moonlink client); Compose overrides host to `nodelink`
- **`MINECRAFT_SERVER_IP`** — Public Minecraft server address shown in verification instructions and used as the `/minecraft status` default (optional)
- **`DISCORD_PRESENCE_INTENT`** — Set to `true` to request the privileged Presence intent (see below; default off)

#### Privileged gateway intents

In the Developer Portal (your app → **Bot**), enable **Server Members Intent** and **Message Content Intent** — Erica always requests both.

**Presence Intent** is opt-in. It powers presence-update logging and the "Online" server-stats counter. To use it, enable it in the portal first, then set:

```env
DISCORD_PRESENCE_INTENT=true
```

Requesting a privileged intent that is not enabled in the portal makes Discord reject the login (close code `4014`), so leave this unset or `false` otherwise.

### 3. Run database migrations

```bash
bun run db:migrate
```

This applies the SQL migrations in `drizzle/` to the MySQL database in `DATABASE_URL` (the script loads `.env`). Pending migrations are also applied automatically every time the bot starts, so this step is optional.

### 4. Configure YAML files

#### `config/status.yml`

Status-page service definitions for `/status` / `/admin status` / the public status API. Copy from `config/status.example.yml`, then `/admin status reload` after edits.

### 5. Configure log/mod-log channels

Use these slash commands in your server after the bot starts:

```
/config log channel type:General Logs     — General event logs (joins, leaves, edits, etc.)
/config log channel type:Moderation Logs  — Moderation action logs
/config log channel type:Member Reports   — Member reports
/ticket setticketlogchannel               — Ticket activity logs and transcripts
```

### 6. HTTP API Server (opt-in)

The website / Minecraft verification / portal role-sync API is **off by default**. Enable it only when you need those integrations:

```env
BOT_API_ENABLED=true
BOT_API_PORT=3001
BOT_API_SECRET=your_shared_secret
PORTAL_API_URL=https://example.com
API_ALLOWED_ORIGINS=https://example.com,https://www.example.com
```

- **`API_ALLOWED_ORIGINS`** — Comma-separated browser origins allowed to call the API (CORS). Leave empty if only servers call it; requests without an `Origin` header are unaffected.

With `BOT_API_ENABLED=false` (or unset), Discord moderation, tickets, music, etc. work normally; website verify and portal sync simply do not run. `/api/health`, `/api/status` and `/api/team` are always served on `BOT_API_PORT`.

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

`bun dev` runs with `NODE_ENV=development` (**debug** logging); `bun start` runs with `NODE_ENV=production` (**info** logging).

### Docker Compose (bot + MySQL + NodeLink)

Music uses **Moonlink.js** talking to a **NodeLink** audio server. Production Compose runs the bot image (`ghcr.io/hax-exe/erica-bot:latest`, built by CI), MySQL and NodeLink:

```bash
docker compose up -d
```

Ensure `.env` has `LAVALINK_PASSWORD`, the `MYSQL_*` credentials, and optionally `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` (passed through to NodeLink). The bot container reads the rest of `.env` via `env_file`, builds `DATABASE_URL` from the `MYSQL_*` values, is wired to `LAVALINK_HOST=nodelink` on the internal network, and applies pending migrations before starting.

#### Running the bot on the host against Compose services

To run `bun dev` on the host while MySQL and NodeLink run in Compose:

```bash
docker compose up -d mysql nodelink
bun run db:migrate
bun dev
```

- Compose publishes MySQL on `127.0.0.1:3306` and NodeLink on `127.0.0.1:3000`. Stop any MySQL already running on the host's port 3306 first.
- `DATABASE_URL` must use the `MYSQL_USER` / `MYSQL_PASSWORD` values (default `erica` / `changeme`), e.g. `mysql://erica:changeme@localhost:3306/erica`. MySQL only applies these when its volume is first created; after changing them run `docker compose down -v` (this deletes the data) and start again.
- `LAVALINK_HOST=localhost`, `LAVALINK_PORT=3000`, and `LAVALINK_PASSWORD` equal to the one Compose passes to NodeLink.
- Use `bun run db:migrate` rather than `bunx drizzle-kit migrate`; the project's migrator handles the pinned `0000` journal entry.

#### Troubleshooting

- **`ER_ACCESS_DENIED_ERROR` on migrate** — the password in `DATABASE_URL` differs from the container's `MYSQL_PASSWORD` (or the volume was created with an older one). The `172.19.0.1`-style address in the error is just the Docker gateway.
- **NodeLink "invalid password" / connection refused** — check `LAVALINK_PORT` is `3000` (not Lavalink's classic `2333`) and the password matches.
- **NodeLink `Cannot read properties of undefined (reading 'getTrackUrl')`** — an old NodeLink image (e.g. 3.3.0) returns YouTube Music tracks with source `ytmusic`, which it cannot play. Update with `docker compose pull nodelink && docker compose up -d nodelink`.
- **NodeLink "Sign in to confirm you're not a bot" (every YouTube client fails)** — YouTube is blocking the server IP. Compose already sets the cipher URL and explicit client lists; the fix is YouTube OAuth with a **burner Google account (never your main account)**:
  1. In `.env` set `NODELINK_YOUTUBE_GET_OAUTH_TOKEN=true`, then `docker compose up -d nodelink`.
  2. Run `docker compose logs -f nodelink`, open the printed Google device URL, enter the code and sign in with the burner account.
  3. Copy the printed refresh token into `NODELINK_YOUTUBE_REFRESH_TOKEN`, set `NODELINK_YOUTUBE_GET_OAUTH_TOKEN=false`, then `docker compose up -d nodelink`. (NodeLink exits after printing the token and Compose restarts it, so flip the flag back promptly.)

  SoundCloud and Deezer are enabled as NodeLink-side fallbacks while YouTube is blocked.

---

## Project Structure

```
src/
├── index.ts                  # Entry point, client setup
├── commands/
│   ├── config/               # /config (log channels)
│   ├── moderation/           # /ban, /kick, /warn, /timeout, /purge, etc.
│   ├── tags/                 # /tag (send, create, edit, delete, …)
│   └── tickets/              # /ticket (panel, reload, add, remove, close)
├── listeners/
│   ├── logging/              # Audit log events (joins, leaves, edits, etc.)
│   ├── tickets/              # Ticket interaction handler
│   └── ready.ts              # Bot ready event
├── lib/
│   ├── brand.ts              # Bot name, User-Agent, webhook names, MC address / CORS env helpers
│   ├── components.ts         # CV2 helpers, colours, reply utilities
│   ├── database.ts           # Drizzle DB instance (applies pending migrations on startup)
│   ├── LoggingUtil.ts        # Shared logging helpers
│   ├── ModerationUtil.ts     # Infraction DB helpers
│   ├── safe.ts               # safeJsonParse, isDuplicateKeyError
│   ├── TagManager.ts         # Tag lookup + autocomplete (MySQL-backed)
│   ├── TicketsConfig.ts      # tickets.yml loader (Zod + YAML)
│   └── TicketManager.ts      # Ticket open/close/transcript logic
├── db/
│   └── schema.ts             # Drizzle schema definitions
├── migrate.ts                # Standalone migration runner (bun run db:migrate, Docker entrypoint)
└── preconditions/            # Sapphire preconditions (e.g. Moderation role check)

config/
├── status.yml                # Status-page services (edit + /admin status reload)
├── status.example.yml
├── tickets.yml               # Ticket panel + categories (edit + /ticket reload)
└── tickets.example.yml       # Documented example with all question types

drizzle/                      # Generated MySQL migrations + meta/ journal and snapshots (commit all)
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
bun run db:generate
```

Commit the new `drizzle/*.sql` file **together with** the updated `drizzle/meta/` (`_journal.json` + snapshot) — the migrator reads the journal to find migrations, and the bot cannot start without it.

Then apply it (or just restart the bot — pending migrations run automatically at startup):

```bash
bun run db:migrate
```

To inspect the database interactively (reads `DATABASE_URL` from the environment or `.env`):

```bash
bun run db:studio
```

---

## Type Checking

```bash
bun tsc --noEmit
```

Run this before pushing to catch any TypeScript errors.
