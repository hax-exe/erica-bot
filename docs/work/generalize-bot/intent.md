# Intent: Generalize Erica (remove Minecraft focus)

Slug: generalize-bot
Status: draft

## Problem
Erica began as a Minecraft community bot. Most of its feature set (moderation, tickets, music, economy, leveling, giveaways, etc.) is already generic, but a bounded set of Minecraft-specific commands, a verification flow, API routes, two DB tables, flavor text, presets, config examples and docs still tie it to Minecraft. Operators running Erica for non-Minecraft communities see irrelevant commands, modules, wording and env vars, and must carry dead code and tables. Source plan: /home/kiana/.claude/plans/plan-to-shift-the-shimmering-moler.md.

## Desired outcome
Approved decisions: (1) remove all Minecraft features, (2) drop the related tables and module column via one new migration, (3) de-brand only, no new features.

Testable statements:
- `/minecraft` and `/mcadmin` no longer exist in the slash command registry.
- The verification panel, its interaction listener, `VerificationUtil` and `VerificationHandler` are gone, with no remaining registration or importers.
- `/api/mc/assign-verified`, `/api/mc/verify` and portal profile sync (`syncPortalProfile`, `PORTAL_API_URL`) are gone. `/api/team` no longer returns `minecraftName`. `/api/health` and `/api/team` still respond.
- `verification` is absent from `MODULES` and `MODULE_LABELS`, and from `/module`, `/config`, `/admin` and `GuildConfigApi` listings.
- `getMinecraftServerAddress()` is removed from `src/lib/brand.ts`.
- Exactly one new drizzle migration drops `minecraft_links`, `pending_verifications`, and the `verification` column on `guild_modules` and `global_modules`. It applies cleanly on both an existing DB and a fresh DB. No existing migration or snapshot is modified.
- Rotating presence (`ready.ts`), economy and fun flavor text contain no Minecraft wording.
- Rank card `minecraft` preset, `bg_minecraft` shop item and Minecraft fonts are removed if unused elsewhere (usage checked first). Existing owned `bg_minecraft` rows and saved presets degrade gracefully (no crash, neutral fallback) without destructive data edits.
- `config/status*.yml` has no "Game Servers" group or port 25565. `config/tickets*.yml` has no Java/Bedrock options or player/gameplay wording.
- `.env.example`, `compose.yml`, `README.md`, `FEATURES.md`, `CLAUDE.md`, `evals/cases/no-hardcoded-brand.json` and `.claude/agents/discord-interaction-reviewer.md` no longer reference Minecraft or the removed helper.
- `grep -rniE "minecraft|bedrock|\bmc\b|mcadmin"` over src, config, .env.example, README.md and FEATURES.md finds only acceptable leftovers (old migrations, handoff.md).
- `bun run verify` and `bun run evals` pass.

## Affected systems
Commands:
- `src/commands/general/minecraft.ts` (delete), `src/commands/general/mcadmin.ts` (delete)
- `src/commands/general/help.ts` (~106, 119)
- `src/commands/config/{module,config,admin}.ts`
- `src/commands/general/economy.ts` (~128, 167)
- `src/commands/fun/fun.ts` (~879)
- `src/commands/general/level.ts` (~68, 172 `validPresets`)

Listeners:
- `src/listeners/verification/interactionCreate.ts` (delete)
- `src/listeners/ready.ts` (presence lines)

Lib:
- `src/lib/ApiServer.ts` (mc routes, portal sync, `minecraftName`, `VERIFICATION_GUILD_ID` / `VERIFIED_ROLE_ID`, "MC rank sync" string)
- `src/lib/VerificationUtil.ts` (delete)
- `src/lib/config/handlers/verification.ts` (delete) and its registration
- `src/lib/config/handlers/feeds.ts` (~57, `r/minecraft` example)
- `src/lib/ModuleUtil.ts`
- `src/lib/GuildConfigApi.ts` (~263)
- `src/lib/brand.ts`
- `src/lib/RankCardUtil.ts` (fonts ~6-8, preset ~136)
- `src/lib/EconomyUtil.ts` (~100-104, `bg_minecraft`)
- `src/index.ts` (~100, comment)

DB:
- `src/db/schema.ts` (`minecraftLinks`, `pendingVerifications`, `verification` columns)
- one new file in `drizzle/` plus `drizzle/meta/`
- `scripts/migrate-sqlite-to-mysql.ts`

Assets and config:
- `assets/fonts/Minecraft-*.ttf` (if unused)
- `config/status.yml`, `config/status.example.yml`, `config/tickets.yml`, `config/tickets.example.yml`

Docs, env and agent files:
- `.env.example`, `compose.yml`, `README.md`, `FEATURES.md`, `CLAUDE.md`
- `evals/cases/no-hardcoded-brand.json`, `.claude/agents/discord-interaction-reviewer.md`

Not affected (look similar but unrelated):
- Discord's native guild verification level in `src/listeners/moderation/antiRaid.ts` and `src/commands/general/info.ts` must stay.

## Constraints
- Never edit, rename, renumber or regenerate existing drizzle migrations or snapshots, and keep the pinned `0000` journal `when`. Generate exactly one new migration with `bun run db:generate` and commit it with `drizzle/meta/`.
- Leave `handoff.md` and old drizzle SQL untouched.
- De-brand only: no new features.
- Follow CLAUDE.md: Bun only, CV2 and ephemeral rules, no hard-coded branding or addresses (`src/lib/brand.ts`).
- No new privileged intents. Removing the verification listener may leave an intent unused; do not change intents without a decision.
- Known impact (accepted): any external website or plugin calling `/api/mc/*` or reading `minecraftName` from `/api/team` will break.
- Table and column drop is irreversible; recommend a DB backup before `db:migrate` in production.
- Run `bun run verify` (the `check-ts` hook misses cross-file breakage).
- A human approves intent, spec, plan, and every commit/PR.

## Open questions
- Owned `bg_minecraft` rows and saved rank-card presets: is a runtime fallback to a neutral preset enough, or should a data cleanup or refund be considered? (Plan says no destructive data edits without confirmation.)
- Which neutral preset or background replaces the Minecraft one, and should the shop item be removed outright or just hidden from the shop?
- Should the Minecraft fonts be deleted if unused, or kept in assets?
- Replacement wording for presence lines, work/mine flavor text, and the "Game Servers" status group name ("Community Servers" vs "Services") and neutral example port.
- Which ticket "platform" options replace Java/Bedrock, and what is the neutral billing option label?
- Should env vars (`MINECRAFT_SERVER_IP`, `VERIFICATION_GUILD_ID`, `VERIFIED_ROLE_ID`, `PORTAL_API_URL`, any others) be removed from code and docs outright, or tolerated silently for deployments that still set them?
- Should the Docker/prod deploy docs include a mandatory backup step before the migration?
- Is `GuildVerification`-related existing per-guild verification config data expected to be exported anywhere before the column drop?
