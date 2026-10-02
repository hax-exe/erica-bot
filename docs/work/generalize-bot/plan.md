# Plan: Generalize Erica (remove Minecraft focus)

Spec: docs/work/generalize-bot/spec.md
Status: done
<!-- allowed: draft, approved, in-progress, done -->

## Tasks

| # | Task | Tier | Status |
|---|------|------|--------|
| T1 | Remove Minecraft commands, verification flow, API routes, module registration, brand helper | implementer-heavy | done |
| T2 | Schema edit, ONE generated drizzle migration, sqlite-to-mysql script | implementer-heavy | done |
| T3 | Neutral wording, rank-card fallback + preset removal, retired shop item filter, font deletion | implementer | done |
| T4A | Neutral status and ticket YAML | implementer-small | done |
| T4B | Env, docs, CLAUDE.md, eval case, reviewer agent file | implementer-small | done |

File sets of tasks run in parallel must be disjoint (checked below).

### T1: Remove Minecraft and verification code (implementer-heavy)
- Goal: delete Minecraft/verification code paths and every reference so `src/` type-checks before the schema change.
- Depends on: none. Satisfies: AC1, AC2, AC3 (src), AC4, AC5 (all except schema.ts), AC12.
- File set:
  - Delete `src/commands/general/minecraft.ts`, `src/commands/general/mcadmin.ts` (also removes the only `VerificationHandler` registration), `src/listeners/verification/interactionCreate.ts` (+ empty dir), `src/lib/VerificationUtil.ts`, `src/lib/config/handlers/verification.ts`.
  - Edit `src/lib/ApiServer.ts`: remove `/api/mc/assign-verified`, `/api/mc/verify`, `syncPortalProfile`, "MC rank sync" string, `minecraftLinks` import/uses (~7, ~540-545, ~729-741), `minecraftName` in `/api/team`, reads of `VERIFICATION_GUILD_ID`, `VERIFIED_ROLE_ID`, `PORTAL_API_URL`. Keep `/api/health`, `/api/team`.
  - Edit `src/lib/brand.ts`: remove `getMinecraftServerAddress()`; keep other exports.
  - Edit `src/lib/ModuleUtil.ts`: remove `verification` from `MODULES` and `MODULE_LABELS`.
  - Edit `src/lib/GuildConfigApi.ts` (~263): remove `verification` from module output.
  - Edit `src/commands/general/help.ts` (~106, ~119): drop `/mcadmin` / Minecraft text.
  - Edit `src/index.ts`: reword ~100 comment only; do not change intents.
  - Verify only (edit if stray reference): `src/commands/config/{module,config,admin}.ts`.
  - Do NOT touch `antiRaid.ts`, `info.ts`, `config/handlers/antiraid.ts`, `logging/guildAuditLogEntryCreate.ts` (Discord's own verification level).
- Notes: `schema.ts` is untouched in T1; remove any code writing `verification` into module insert objects. After: `grep -rn "verification" src` shows only Discord verification-level hits.

### T2: Schema and migration (implementer-heavy)
- Goal: drop two tables and two `verification` columns via exactly one generated migration.
- Depends on: T1 landed. Must run alone (db:generate snapshots the whole schema). Satisfies: AC5 (schema), AC6, AC13.
- File set:
  - Edit `src/db/schema.ts`: remove `minecraftLinks`, `pendingVerifications` (+ comments, ~448-457), and `verification` columns on `guild_modules` (~352) and `global_modules` (~378).
  - Add exactly one `drizzle/NNNN_*.sql` via `bun run db:generate`; update `drizzle/meta/_journal.json`; add one `drizzle/meta/NNNN_snapshot.json`.
  - Edit `scripts/migrate-sqlite-to-mysql.ts` (~68): drop removed tables from list; skip `verification` column in module-table copy.
- Notes: run `db:generate` once; never hand-edit generated meta or existing migrations (if wrong, revert and redo). SQL must contain only 2x `DROP TABLE` and 2x `ALTER TABLE ... DROP COLUMN`. `git diff --stat -- drizzle` shows only added files + `_journal.json`; `0000` `when` still `1700000000000`. Apply on a fresh empty DB and on a DB with prior migrations applied (disposable local MySQL only).

### T3: Wording, rank card, shop, fonts (implementer)
- Goal: neutral flavor/presence text, rank-card preset fallback, retired-item handling, font removal.
- Depends on: none (parallel with T1, T4A, T4B). Satisfies: AC7, AC8, AC9, AC10 (src), AC11 (src).
- File set:
  - `src/listeners/ready.ts`: replace Minecraft presence block with neutral lines.
  - `src/commands/general/economy.ts`: reword ~128/~167 flavor; filter retired `bg_minecraft` key in shop listing (~1502, ~1840) and buy (~1525, ~1875) paths in code only; no row edits/deletes.
  - `src/commands/fun/fun.ts` (~879): replace/remove `'minecraft'` entry after checking context.
  - `src/lib/config/handlers/feeds.ts` (~57): neutral subreddit example.
  - `src/lib/EconomyUtil.ts` (~100-104): remove `bg_minecraft` from default shop items (optional shared retired-keys constant).
  - `src/lib/RankCardUtil.ts`: remove three `registerFromPath` Minecraft font lines (~6-8) and `minecraft` from `PRESET_BACKGROUNDS` (~136); add exported `DEFAULT_PRESET` (`galaxy`); unknown preset (~161) falls back to it, never throws.
  - `src/commands/general/level.ts`: ~68 description and ~172 `validPresets` -> cyberpunk, galaxy, sunset.
  - Add `src/lib/RankCardUtil.test.ts` (pure helper, no canvas/network): `minecraft`/unknown -> default.
  - Delete `assets/fonts/Minecraft-Seven_v2.ttf`, `Minecraft-Tenv2.ttf`, `MinecraftFive-Regular.ttf`.
- Notes: re-grep `MCseven|MCten|MCfive|Minecraft-` (excl. node_modules, .git, drizzle) before deleting fonts; if used elsewhere stop and record in Deviations. Record `DEFAULT_PRESET` in PR notes. Mining mechanics / `diamond_pick` stay. No `content` with `IsComponentsV2`.

### T4A: YAML config (implementer-small)
- Depends on: none. Satisfies: AC10 (config), AC11 (config).
- File set: `config/status.yml`, `config/status.example.yml`, `config/tickets.yml`, `config/tickets.example.yml`.
- Changes: "Game Servers" -> "Community Servers"; port 25565 -> 8080; Java/Bedrock select options -> Discord / Website / Other (tickets.yml ~171-175, ~232-236; example ~60-64); reword "player"/"gameplay" (tickets.yml ~92, ~204; example ~31); neutral billing option label. Keep structure so `/ticket reload` loads it. Structural change needed -> bounce to `implementer`.

### T4B: Env, docs, CLAUDE.md, eval, reviewer agent (implementer-small)
- Depends on: none to run; `bun run evals` passes only after T1. Satisfies: AC3 (docs), AC11 (docs), AC14.
- File set:
  - `.env.example`: remove `MINECRAFT_SERVER_IP`, `VERIFICATION_GUILD_ID`, `VERIFIED_ROLE_ID`, `PORTAL_API_URL`.
  - `compose.yml`: remove Minecraft/verification env vars.
  - `README.md` (~45, ~87-93, ~173): drop Minecraft / portal content; add mandatory "back up the database before `bun run db:migrate`".
  - `FEATURES.md`: remove Minecraft/verification entries.
  - `CLAUDE.md`: remove `getMinecraftServerAddress()` from the `brand.ts` line (~60); Branding bullet (~79) names only `getAllowedOrigins()`; remove `MINECRAFT_SERVER_IP` env line (~155); reword "website/MC API" (~156). No other edits; weaken no convention.
  - `evals/cases/no-hardcoded-brand.json`: drop `getMinecraftServerAddress` clause; keep `USER_AGENT` and outbound-HTTP checks.
  - `.claude/agents/discord-interaction-reviewer.md`: remove Minecraft references and removed helper.
- Notes: human approved implementers editing `CLAUDE.md` and the reviewer agent file.

## Disjointness check
- T1 only: `index.ts`, `help.ts`, `ApiServer.ts`, `brand.ts`, `ModuleUtil.ts`, `GuildConfigApi.ts`.
- T3 only: `RankCardUtil.ts`, `level.ts`, `economy.ts`, `EconomyUtil.ts`, `ready.ts`, `fun.ts`, `feeds.ts`, font files.
- T2 only: `schema.ts`, `drizzle/**`, `scripts/migrate-sqlite-to-mysql.ts`.
- T4A only: `config/*.yml`. T4B only: docs, env, `CLAUDE.md`, `evals`, `.claude/agents`.

## Order
1. Group A (parallel): T1, T3, T4A, T4B.
2. Group B (alone, after T1 in tree): T2.
3. Gate: all tasks done.
4. `verifier`, then `migration-reviewer` (T2), `discord-interaction-reviewer` (T1, T3), `spec-compliance-reviewer` (AC1-15). Reviewers are never implementers. Human reviews diff and approves commit/PR; PR notes include the DB-backup instruction.

## Verification
- `bun install`; `bun run verify`; `bun run evals`.
- AC2: `grep -rn "VerificationUtil\|VerificationHandler" src` empty.
- AC3: `grep -rn "mc/assign-verified\|mc/verify\|syncPortalProfile\|PORTAL_API_URL\|VERIFICATION_GUILD_ID\|VERIFIED_ROLE_ID\|MINECRAFT_SERVER_IP\|getMinecraftServerAddress" src config .env.example compose.yml README.md FEATURES.md CLAUDE.md evals .claude` empty.
- AC11: `grep -rniE "minecraft|bedrock|mcadmin" ...` and `\bmc\b` empty, except the unrelated local variable `mc` in `src/listeners/boosts/guildMemberUpdate.ts` (decision: leave the file untouched, exclude from grep). Leftovers allowed only in old `drizzle/`, `handoff.md`, `docs/work/`.
- AC10: `grep -rniE "minecraft|bedrock|java edition|25565|game servers|player|gameplay" config` empty; ready.ts / fun.ts clean in edited regions (`player` is legitimate in music code).
- AC9: `ls assets/fonts` shows only Montserrat. AC12: `git diff --stat -- src/listeners/moderation/antiRaid.ts src/commands/general/info.ts` empty; `src/index.ts` diff comment-only.
- AC6: `git status --porcelain drizzle` shows only added files + modified `_journal.json`; `0000` `when` = `1700000000000`; `bun run db:migrate` on fresh and pre-migrated disposable MySQL (never production).
- AC4: `bun dev` with `BOT_API_ENABLED=true`; `/api/health` and `/api/team` respond, no `minecraftName`; `/api/mc/verify` 404.
- AC1: `/minecraft` and `/mcadmin` absent from registered commands. AC10: `/ticket reload` on a scratch guild.

## Deviations
Implementers record departures here with the reason.

- T1 (ApiServer.ts): the plan's line refs only named the `/api/mc/*` routes, but `/api/guild/member/:id` and `/api/guild/set-roles` also read `VERIFICATION_GUILD_ID`. The spec requires removing every read of that var (AC3 grep), and neither route is Minecraft-specific, so both now use the existing `SUPPORT_GUILD_ID` (already used by `/api/team`) instead of being deleted. Impact: deployments must set `SUPPORT_GUILD_ID` for these two routes (T4B docs may want to mention this). The `'MC rank sync'` audit-log reason became `'API role sync'`.
- T1 (ApiServer.ts): `VERIFIED_ROLE_ID` dropped from the `/api/guild/set-roles` role whitelist (`ALLOWED_ROLE_IDS`). `resolveRank`, `PortalRank` and `RANK_PRIORITY` were removed too, because only `/api/mc/verify` and `/mcadmin` used them. The now-unused `assignVerifiedSchema`/`verifySchema` and the `db` import also went.
- T3: added exported helper `resolvePresetBackground()` and `RETIRED_ITEM_KEYS` (EconomyUtil) so the fallback is testable without canvas. Retired-key filter applied only to shop list and shop buy (plan's ~1502/~1525 inventory/use lines are not shop paths; inventory/use untouched). `fun.ts` `'minecraft'` was a hangman word; removed. Font re-grep found uses only in RankCardUtil registration lines; fonts deleted. `DEFAULT_PRESET = 'galaxy'` (for PR notes).
- T2: generated `drizzle/0003_remarkable_old_lace.sql` (+ `meta/0003_snapshot.json`, journal entry idx 3). In `scripts/migrate-sqlite-to-mysql.ts` the `verification` skip is a `SKIPPED_COLUMNS` map (guild_modules, global_modules) applied to the MySQL column list, so it also holds against a MySQL target still on 0002. Migration application was checked on a throwaway `mysql:8.4` container (host network, port 33099, tmpfs, removed afterwards), not the compose volume: Docker bridge networking failed in this environment, so `--network host` was used. Fresh DB: 0000-0003 applied. Pre-migrated DB (0000-0002 applied from a scratch copy with a seeded `guild_modules` row): 0003 applied, tables and columns gone, row kept.
- Reviewer follow-ups: README.md brand.ts description updated to "Bot name, User-Agent, webhook names, CORS origins env helper"; economy.ts mining message changed to "Your pickaxe hit solid stone. No luck."; .env.example SUPPORT_GUILD_ID comment and README API section updated to document requirement for `/api/guild/member/:id` and `/api/guild/set-roles`; unused `DISCORD_ROLE_LEADERSHIP` and `DISCORD_ROLE_ADMIN` vars removed from .env.example. Human decisions: retain SUPPORT_GUILD_ID for API routes (already required by `/api/team`); accept VERIFIED_ROLE_ID narrowing in `/api/guild/set-roles` allowlist.
