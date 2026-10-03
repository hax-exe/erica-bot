# Erica — Agent Guidelines

Erica, a Discord bot. Bun runtime + Sapphire Framework v5 + Drizzle ORM + MySQL (mysql2).

## Workflow (AI-native SDLC)

Pipeline: plan -> build -> verify -> review. Artifacts live in `docs/work/<slug>/plan.md` (templates in `docs/work/_templates/`).

| Stage | Agent |
|---|---|
| Plan | Claude Code native plan mode (tasks, file sets, tier per task), saved to `plan.md` |
| Build | `implementer-small` (trivial) / `implementer` (normal) / `implementer-heavy` (multi-file, schema, overhauls) |
| Verify | `verifier` |
| Review | `discord-interaction-reviewer`, `migration-reviewer` |

Rules:
- The orchestrator (main session) does not write code; it delegates.
- Parallelize implementers only on disjoint file sets.
- `implementer` and `implementer-heavy` need an approved `plan.md` task. Trivial tasks skip plan (`implementer-small` only; it bounces anything non-trivial).
- Run `verifier` before reporting done.
- Reviewers are never the implementer.
- A human approves the plan and every commit/PR.
- `REVIEW.md` governs reviews.
- `CLAUDE_FIX_MODE=1`: the human exports it before launching the session; the hooks then block edits to existing test files (fix the code, not the tests).

## Things Claude gets wrong

- `check-ts` hook only reports type errors in the edited file. Cross-file breakage shows up only in `verifier` / `bun run verify`, so run it before reporting done.
- Select menus: `interaction.update()` first, `followUp()` after; `showModal()` must be the sole response.
- Never edit, rename or regenerate existing drizzle migrations or snapshots.
- Never use `npm`/`yarn`/`npx`; use `bun`/`bunx`.
- Never set `content` with `IsComponentsV2`; never `ephemeral: true`.
- Never hard-code branding, server addresses or domains (`src/lib/brand.ts`).

## Build & Dev

```bash
bun install               # install deps
bun dev                   # bun --watch src/index.ts
bun start                 # production
bun run db:migrate        # apply pending migrations
bun run db:generate       # generate new migration from schema changes
bun tsc --noEmit          # type-check (no build output)
bun test                  # run tests
bun run verify            # typecheck + biome check + test
```

**Do not use `npm` or `yarn`.** Bun is both runtime and package manager.

## Project Structure

```
src/
  commands/          # slash commands (auto-loaded)
  listeners/         # Discord/Sapphire listeners (auto-loaded)
  lib/               # shared utilities (music, tickets, API, etc.)
    brand.ts         # BOT_NAME, USER_AGENT, WEBHOOK_NAMES, getAllowedOrigins()
    safe.ts          # safeJsonParse(), isDuplicateKeyError()
    database.ts      # Drizzle instance; applies pending migrations on import
  preconditions/     # Sapphire preconditions (BotAdmin, Moderation, …)
  db/schema.ts       # Drizzle table definitions
  index.ts
  migrate.ts         # standalone migration runner (db:migrate, Docker CMD)
config/
  status.yml         # status page services (YAML source of truth)
  status.example.yml
  tickets.yml        # ticket panel + categories (YAML source of truth)
  tickets.example.yml
drizzle/             # SQL migrations + meta/ (journal + snapshots — always commit)
```

Toggleable modules include `autoresponder`, `verification`, `rolePersistence`, `inviteTracking`, and `highlights` (`/module` to toggle; see FEATURES.md for descriptions).

### Shared helpers

- **Branding**: the bot is "Erica". Use `BOT_NAME`, `USER_AGENT` (outbound HTTP `User-Agent`) and `WEBHOOK_NAMES` from `src/lib/brand.ts` instead of hard-coding names. Never hard-code server addresses or website domains — use `getAllowedOrigins()` (`API_ALLOWED_ORIGINS`).
- **`src/lib/safe.ts`**: `safeJsonParse(raw, fallback)` for JSON stored in text columns (never throws); `isDuplicateKeyError(err)` to detect MySQL `ER_DUP_ENTRY` through Drizzle's error wrapping.

## Architecture Conventions

### Discord.js / Sapphire

- **Components V2 (CV2)**: Use `IsComponentsV2` flag (`CV2_FLAG`) + `ContainerBuilder`. **Never** set `content` and `IsComponentsV2` in the same message — Discord error 50035.
- **Ephemeral**: Always `flags: MessageFlags.Ephemeral` — never `ephemeral: true`.
- **Select menus**: `StringSelectMenuInteraction` must use `interaction.update()` as its primary response. Use `interaction.followUp()` for feedback after the update. `showModal()` must be the sole response when called.
- **Error 10062 / 40060**: Stale interactions after bot restart — catch and silently discard, never re-throw.

### Database

- Schema lives in `src/db/schema.ts`. After editing it, run `bun run db:generate` then `bun run db:migrate`.
- Commit each generated `drizzle/NNNN_*.sql` together with `drizzle/meta/` (`_journal.json` + snapshot). The migrator needs the journal, and the bot runs pending migrations on startup (`src/lib/database.ts`); Docker also runs `src/migrate.ts` first.
- Never rename, renumber or regenerate existing migrations. The journal `when` of `0000_overrated_otto_octavius` is pinned to `1700000000000` on purpose: databases that already applied it skip it, and fresh databases run everything. Drizzle only runs entries whose `when` is newer than the last applied one.
- Store millisecond durations and epoch-ms timestamps in `bigint(..., { mode: 'number' })`, not `int` (32-bit, overflows past ~24.8 days).
- Runtime DB is **MySQL** via `DATABASE_URL` (e.g. `mysql://user:pass@localhost:3306/erica`).
- One-off SQLite → MySQL data copy: `bun run migrate:sqlite-to-mysql` (`SQLITE_PATH` / `DATABASE_PATH` = source file).

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
docker compose up -d
```

Compose overrides `LAVALINK_HOST=nodelink`. For `bun dev` on the host, `docker compose up -d mysql nodelink` — Compose publishes MySQL on `127.0.0.1:3306` and NodeLink on `127.0.0.1:3000`; set `DATABASE_URL` to the `MYSQL_USER`/`MYSQL_PASSWORD` values (applied only when the MySQL volume is first created), `LAVALINK_PORT=3000` and a matching `LAVALINK_PASSWORD`. Or point `LAVALINK_*` at a remote host. Keep the NodeLink image current (`docker compose pull nodelink`): old builds (3.3.0) crash with `getTrackUrl` on `ytmusic` tracks.

YouTube "Sign in to confirm you're not a bot" (all clients rejected) means YouTube blocks the server IP. Compose sets `NODELINK_SOURCES_YOUTUBE_CIPHER_URL`, explicit client lists and Deezer/SoundCloud fallbacks (image pinned to `performanc/nodelink:3.9.0`). Fix with YouTube OAuth on a **burner Google account, never a main account**: set `NODELINK_YOUTUBE_GET_OAUTH_TOKEN=true` in `.env`, `docker compose up -d nodelink`, follow the device-flow URL/code in `docker compose logs nodelink`, paste the refresh token into `NODELINK_YOUTUBE_REFRESH_TOKEN`, then set the flag back to `false`.

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
DISCORD_TOKEN=           # required — startup fails fast without it
BOT_OWNER_IDS=
DATABASE_URL=mysql://user:pass@localhost:3306/erica
LAVALINK_HOST=localhost
LAVALINK_PORT=3000
LAVALINK_PASSWORD=
DISCORD_PRESENCE_INTENT=false  # true only if Presence Intent is enabled in the Developer Portal (else login fails, 4014)
BOT_API_ENABLED=false    # set true to enable website API
BOT_API_SECRET=          # required when API is enabled
API_ALLOWED_ORIGINS=     # comma-separated CORS origins for the API
```

Gateway intents are set in `src/index.ts`. `GuildMembers` and `MessageContent` are privileged and always requested. `GuildPresences` is privileged and only added when `DISCORD_PRESENCE_INTENT=true`. A listener for a new event type may need a new intent there.
