# Erica — Agent Guidelines

AloraMC's Discord bot. Bun runtime + Sapphire Framework v5 + Drizzle ORM + MySQL (mysql2).

## Build & Dev

```bash
bun install               # install deps
bun dev                   # bun --watch src/index.ts  (uses .env.dev)
bun start                 # production (uses .env.prod)
bun run db:migrate        # apply pending migrations
bun run db:generate       # generate new migration from schema changes
bun tsc --noEmit          # type-check (no build output)
```

**Do not use `npm` or `yarn`.** Bun is both runtime and package manager.

## Project Structure

```
src/
  commands/          # slash commands (auto-loaded)
  listeners/         # Discord/Sapphire listeners (auto-loaded)
  lib/               # shared utilities (music, tickets, API, etc.)
  preconditions/     # Sapphire preconditions (BotAdmin, Moderation, …)
  db/schema.ts       # Drizzle table definitions
  index.ts
config/
  status.yml         # status page services (YAML source of truth)
  status.example.yml
  tickets.yml        # ticket panel + categories (YAML source of truth)
  tickets.example.yml
drizzle/             # SQL migrations
```

Toggleable modules include `autoresponder` (`/autoresponder` + message listener).

## Architecture Conventions

### Discord.js / Sapphire

- **Components V2 (CV2)**: Use `IsComponentsV2` flag (`CV2_FLAG`) + `ContainerBuilder`. **Never** set `content` and `IsComponentsV2` in the same message — Discord error 50035.
- **Ephemeral**: Always `flags: MessageFlags.Ephemeral` — never `ephemeral: true`.
- **Select menus**: `StringSelectMenuInteraction` must use `interaction.update()` as its primary response. Use `interaction.followUp()` for feedback after the update. `showModal()` must be the sole response when called.
- **Error 10062 / 40060**: Stale interactions after bot restart — catch and silently discard, never re-throw.

### Database

- Schema lives in `src/db/schema.ts`. After editing it, run `bun run db:generate` then `bun run db:migrate`.
- Runtime DB is **MySQL** via `DATABASE_URL` (e.g. `mysql://user:pass@localhost:3306/erica`).
- One-off SQLite → MySQL data copy: `bun run migrate:sqlite-to-mysql` (`SQLITE_PATH` / `DATABASE_PATH` = source file).
- Legacy SQLite SQL lives in `drizzle-sqlite-legacy/` (reference only).

### Logging

All log types dispatch via `WebhookClient` — no channel IDs stored.

| Helper | Webhook column |
|---|---|
| `sendLog` | `logWebhookUrl` |
| `sendModLog` | `modLogWebhookUrl` |
| `sendTicketLog` | `ticketLogWebhookUrl` |
| `sendReportLog` | `reportWebhookUrl` |

### Preconditions

| Precondition | Scope | Who passes |
|---|---|---|
| `NotBlacklisted` | Global | Anyone not in `bot_blacklist` |
| `BotAdmin` | Command-level | IDs in `BOT_OWNER_IDS` |
| `Moderation` | Command-level | ManageGuild / KickMembers / BanMembers |
| `TicketStaff` | Command-level | Ticket category staff roles |

### Music

Moonlink.js client → **NodeLink** audio server (Lavalink-compatible). Docker Compose runs both (`bot` + `nodelink`).

```bash
docker compose --env-file .env.prod up -d
```

Compose overrides `LAVALINK_HOST=nodelink`. For `bun dev`, run NodeLink on `:3000` or point `LAVALINK_*` at a remote host.

### Ticket System

- Panel + categories live in **`config/tickets.yml`** (hex colors, modern modal fields: text / select / file / checkbox / checkboxGroup). See `config/tickets.example.yml`.
- Setup: edit YAML → `/ticket reload` → `/ticket panel`. Open ticket rows stay in MySQL.
- Support Status voice labels: `panel.statusChannels` in `tickets.yml` (no slash command).
- Welcome FAQ: create a tag named `faq` — welcome messages show a **Server FAQ** button.
- Transcripts: HTML/TXT under `data/transcripts/`; `GET /api/transcripts/:code` when API enabled.
- Tickets are **text channels** under a Discord category (`discordCategoryId` per category).
- Closing: transcript → archive category or delete after a short delay.
- Enable Discord Developer Mode to Copy ID for channels, roles, and categories.

## Environment Variables

See [`.env.example`](.env.example) for the full list. Runtime essentials:

```env
DISCORD_TOKEN=
BOT_OWNER_IDS=
DATABASE_URL=mysql://user:pass@localhost:3306/erica
LAVALINK_HOST=localhost
LAVALINK_PORT=3000
LAVALINK_PASSWORD=
BOT_API_ENABLED=false    # set true to enable website/MC API
BOT_API_SECRET=          # required when API is enabled
```
