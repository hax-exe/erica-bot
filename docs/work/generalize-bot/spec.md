# Spec: Generalize Erica (remove Minecraft focus)

Intent: docs/work/generalize-bot/intent.md
Status: draft, awaiting human approval

## Decisions (resolved by the human; not open questions)

1. Rank card: the `minecraft` preset and the `bg_minecraft` shop item are removed. Owned `bg_minecraft` inventory rows and saved presets with `backgroundValue = 'minecraft'` fall back to a neutral preset at render time. No data edits, no refunds. The Minecraft fonts are deleted only if grep shows no other use (see Design, "Fonts").
2. Env vars `MINECRAFT_SERVER_IP`, `VERIFICATION_GUILD_ID`, `VERIFIED_ROLE_ID` and `PORTAL_API_URL` are removed outright from code and `.env.example`. No deprecation warning, no silent tolerance.
3. Implementing agents choose neutral wording: status group "Community Servers", example port 8080, ticket platform options Discord / Website / Other, neutral presence and flavor lines. The human reviews the diff before commit.
4. The spec and the PR notes must require a DB backup before `bun run db:migrate`, because the table and column drop is irreversible. No export script and no per-guild data export are built.
5. Gateway intents stay unchanged. Finding (see Design, "Intents"): no intent is used only by the removed code, so nothing needs flagging.
6. Discord's own `GuildVerificationLevel` usage in `src/listeners/moderation/antiRaid.ts` and `src/commands/general/info.ts` stays untouched.

## Behavior

De-brand only. No new features. After the change:

- `/minecraft` and `/mcadmin` are not registered. `/help` text (`src/commands/general/help.ts` ~106, ~119) no longer mentions `/mcadmin` or Minecraft; the remaining staff commands stay listed.
- The Minecraft verification panel, its button/interaction listener, `VerificationUtil` and `VerificationHandler` do not exist and nothing imports them.
- `verification` is not a module: absent from `MODULES` and `MODULE_LABELS` (`src/lib/ModuleUtil.ts`), from `/module`, `/config` and `/admin` listings, and from `GuildConfigApi` module output (`src/lib/GuildConfigApi.ts` ~263). The `verification` config handler (`src/lib/config/handlers/verification.ts`) and its registration are deleted.
- API (`src/lib/ApiServer.ts`): `/api/mc/assign-verified`, `/api/mc/verify`, `syncPortalProfile`, the "MC rank sync" string, and reads of `VERIFICATION_GUILD_ID` / `VERIFIED_ROLE_ID` / `PORTAL_API_URL` are removed. `/api/team` no longer returns `minecraftName` (the `minecraft_links` read is removed; other fields unchanged). `/api/health` and `/api/team` still respond. Known accepted impact: external callers of `/api/mc/*` or readers of `minecraftName` break. The `src/index.ts` ~100 comment is reworded ("Website/MC/config routes" becomes neutral).
- `getMinecraftServerAddress()` is removed from `src/lib/brand.ts`. `getAllowedOrigins()`, `BOT_NAME`, `USER_AGENT`, `WEBHOOK_NAMES` stay.
- Rank card: `PRESET_BACKGROUNDS` in `src/lib/RankCardUtil.ts` loses `minecraft`. `/level` background preset option (`src/commands/general/level.ts` ~68 description, ~172 `validPresets`) offers only cyberpunk, galaxy, sunset. At render time, `backgroundType === 'preset'` with a value not in `PRESET_BACKGROUNDS` (including `minecraft`) renders a neutral default preset instead of no image; implementers define a `DEFAULT_PRESET` constant (suggested `galaxy`) and note the choice in the PR. A missing/unknown key must never throw.
- Shop: the `bg_minecraft` entry is removed from the default item list in `src/lib/EconomyUtil.ts` (~100-104) so it is not seeded for new guilds. Existing guilds already have a `shop_items` row; shop listing/buy paths must not offer `bg_minecraft` for purchase (code-level filter of the retired key; no row deletion). Users who own it keep the inventory row; it is simply inert, and `/level` rejects `minecraft` as a new preset.
- Wording: rotating presence (`src/listeners/ready.ts` "Minecraft Humor" block), work flavor (`economy.ts` ~128 "mined Minecraft diamonds") and the `fun.ts` ~879 `'minecraft'` entry (implementer checks context and replaces/removes) contain no Minecraft terms. `feeds.ts` ~57 comment example `r/minecraft` becomes a neutral subreddit example. Mining mechanics (`/economy earn mine`, `diamond_pick`) are generic and stay.
- Config: `config/status.yml` and `status.example.yml` group "Game Servers" becomes "Community Servers"; example port 25565 becomes 8080. `config/tickets.yml` and `tickets.example.yml`: Java/Bedrock select options (tickets.yml ~171-175, ~232-236; example ~60-64) become Discord / Website / Other; "player", "gameplay" descriptions (tickets.yml ~92, ~204; example ~31) are reworded neutrally. The billing option label is made neutral by the implementer. `config/tickets.yml` must still load with `/ticket reload`.
- Docs/env/agents: `.env.example`, `compose.yml`, `README.md` (~45, ~87-93, ~173), `FEATURES.md`, `CLAUDE.md` (lines ~60, ~79, ~155-156 and the "website/MC API" comment), `evals/cases/no-hardcoded-brand.json` and `.claude/agents/discord-interaction-reviewer.md` drop Minecraft references and the removed helper. The eval case keeps checking that `brand.ts` exports `USER_AGENT` and that outbound HTTP imports it, dropping the `getMinecraftServerAddress` clause. README and PR notes include a mandatory "back up the database before `bun run db:migrate`" step.

## Design

### Deletions
- `src/commands/general/minecraft.ts`, `src/commands/general/mcadmin.ts`
- `src/listeners/verification/interactionCreate.ts` (and the now-empty directory)
- `src/lib/VerificationUtil.ts`, `src/lib/config/handlers/verification.ts` plus its registration
- `assets/fonts/Minecraft-Seven_v2.ttf`, `Minecraft-Tenv2.ttf`, `MinecraftFive-Regular.ttf`, and the three `GlobalFonts.registerFromPath` lines at `RankCardUtil.ts` 6-8. Keep Montserrat fonts.

### Fonts
Grep over the repo (excluding node_modules, .git, drizzle) shows `MCseven`, `MCten`, `MCfive` and the font file names appear only in the three registration lines of `RankCardUtil.ts`; every `ctx.font` uses `SANS`. They are unused, so deletion is approved by decision 1. Implementer re-greps before deleting.

### Intents
`src/index.ts` intents: Guilds, GuildMembers, GuildModeration, GuildMessages, GuildMessageReactions, GuildVoiceStates, GuildInvites, MessageContent, DirectMessages, GuildMessagePolls, GuildScheduledEvents, optional GuildPresences. The removed verification listener only handled `interactionCreate`, and the API role assignment used REST member fetch/role add; none of these intents is exclusive to removed code (GuildMembers is also used by member-update, boosts and logging listeners). No change. Implementer must not alter intents.

### Schema and migration (`src/db/schema.ts`)
- Remove tables `minecraftLinks` (`minecraft_links`) and `pendingVerifications` (`pending_verifications`) and their comment headers (~448-457+).
- Remove the `verification` boolean column from the guild modules table (~352) and global modules table (~378).
- Run `bun run db:generate` exactly once to produce exactly one new `drizzle/NNNN_*.sql` plus the updated `drizzle/meta/` (`_journal.json` + new snapshot). Commit them together. Existing migrations/snapshots are not edited, renamed, renumbered or regenerated; the pinned `0000` journal `when` stays. Review the generated SQL: only `DROP TABLE` x2 and `ALTER TABLE ... DROP COLUMN` x2.
- No ms/epoch columns are added, so the `bigint(..., { mode: 'number' })` rule is not triggered.
- Must apply cleanly on an existing DB and a fresh DB (fresh DBs run all migrations including the new one).
- `scripts/migrate-sqlite-to-mysql.ts` (~68): remove `minecraft_links` and `pending_verifications` from the table list, and handle the dropped `verification` column in module tables so the script does not insert a nonexistent column.
- Irreversible: backup required before `db:migrate` (README, PR notes). No export tooling.

### Code touch points
`ModuleUtil.ts` (MODULES line ~18, labels ~44), `GuildConfigApi.ts`, `commands/config/{module,config,admin}.ts`, `ApiServer.ts` (remove the `minecraftLinks` import and uses at ~7, ~540-545, ~729-741), `brand.ts` (~23-28), `EconomyUtil.ts`, `RankCardUtil.ts`, `level.ts`, `help.ts`, `economy.ts`, `fun.ts`, `ready.ts`, `feeds.ts`, `index.ts`. Also grep `src` for any remaining `verification` module key references (for example `guildAuditLogEntryCreate.ts`, `antiraid.ts` handler) and keep only the Discord verification-level usage.

## Policy checklist
- [x] CV2 only (no `content` with IsComponentsV2); ephemeral via flags. Not newly applicable: no new messages. Edited text-only strings (help, economy, presence) keep their existing CV2/flag usage and must not add `content` alongside `IsComponentsV2` or `ephemeral: true`.
- [x] Select menus: update() first; showModal() sole response; 10062/40060 swallowed. Not applicable: no interaction handlers are added; removals only. Existing handlers (module/config/admin select menus) must keep their patterns when the `verification` option is removed from option lists.
- [x] Branding/addresses from src/lib/brand.ts. Applies: `getMinecraftServerAddress` is removed, nothing replaces it, and no server address or domain is hard-coded (the 8080 example port in YAML is a port only; the README's `https://example.com` PORTAL example goes away with the var). CLAUDE.md branding bullet is updated to name only `getAllowedOrigins()`.
- [x] `safeJsonParse` / `isDuplicateKeyError` (`src/lib/safe.ts`): not applicable; no new JSON parsing or duplicate handling. Do not remove those helpers.
- [x] Logging via sendLog / sendModLog / sendTicketLog / sendReportLog. Not applicable: no logging added. Removed code's `container.logger` calls leave with it.
- [x] New migration only; existing migrations untouched. Applies (see Design).
- [x] Preconditions: not applicable; removed commands carried `Moderation`/`NotBlacklisted` and no command gains or changes a precondition.
- [x] Bun only: all commands via `bun` / `bunx`.

## Policy conflicts
None blocking. Notes for the human:
- The task requires editing `CLAUDE.md` and `.claude/agents/discord-interaction-reviewer.md`. They are project config/policy files outside the spec-writer's remit; this spec only describes the required edit and an implementer performs it after approval. Edits are limited to removing Minecraft references and the removed helper; no convention is weakened. Confirm you accept implementers editing `CLAUDE.md`.
- `evals/cases/no-hardcoded-brand.json` currently asserts `getMinecraftServerAddress` exists; it must be edited in the same change or `bun run evals` fails.

## Acceptance criteria
1. `/minecraft` and `/mcadmin` are absent from the registered slash commands; `src/commands/general/minecraft.ts` and `mcadmin.ts` do not exist.
2. `VerificationUtil.ts`, `config/handlers/verification.ts`, `listeners/verification/` do not exist; `grep -rn "VerificationUtil\|VerificationHandler" src` returns nothing.
3. `grep -rn "mc/assign-verified\|mc/verify\|syncPortalProfile\|PORTAL_API_URL\|VERIFICATION_GUILD_ID\|VERIFIED_ROLE_ID\|MINECRAFT_SERVER_IP\|getMinecraftServerAddress" src config .env.example compose.yml README.md FEATURES.md CLAUDE.md evals .claude` returns nothing.
4. `GET /api/health` and `GET /api/team` respond when the API is enabled; `/api/team` members have no `minecraftName`.
5. `verification` is absent from `MODULES`, `MODULE_LABELS`, `/module`, `/config`, `/admin` and `GuildConfigApi` output; `src/db/schema.ts` has no `verification` column, `minecraftLinks` or `pendingVerifications`.
6. `drizzle/` gains exactly one new migration (plus meta journal entry and snapshot) containing only the two table drops and two column drops; `git diff` shows no change to existing migration/snapshot files and `0000`'s journal `when` is still `1700000000000`. `bun run db:migrate` succeeds on an existing DB and on an empty DB.
7. `PRESET_BACKGROUNDS` has no `minecraft`; `/level` accepts only cyberpunk, galaxy, sunset; `renderRankCard` with `backgroundType: 'preset', backgroundValue: 'minecraft'` resolves to the neutral default preset and does not throw (unit test).
8. `bg_minecraft` is not in the default shop item list, not purchasable in any guild, and no rows in `shop_items`/`user_inventory` are modified or deleted.
9. The three Minecraft font files and their registration lines are gone; rank cards still render; `assets/fonts/Montserrat-*` remain.
10. Presence, economy and fun text, `feeds.ts` example, `config/status*.yml` and `config/tickets*.yml` contain none of: Minecraft, Bedrock, Java Edition, `25565`, "Game Servers", "player", "gameplay"; the status group is "Community Servers" with port 8080 and ticket platform options are Discord / Website / Other. `/ticket reload` accepts the edited YAML.
11. `grep -rniE "minecraft|bedrock|\bmc\b|mcadmin" src config .env.example README.md FEATURES.md CLAUDE.md compose.yml evals .claude` finds nothing; acceptable leftovers are limited to old `drizzle/` files, `handoff.md` and `docs/work/`.
12. `antiRaid.ts` and `info.ts` are unchanged; `src/index.ts` intents are unchanged (only the comment may change).
13. `scripts/migrate-sqlite-to-mysql.ts` no longer references removed tables or the `verification` column.
14. README and PR description contain an explicit "back up the database before `bun run db:migrate`" instruction.
15. `bun run verify` and `bun run evals` pass.

## Out of scope
- New features, replacement verification flow, or new commands.
- Data export, backup scripts, refunds, or any edit/deletion of existing `shop_items`, `user_inventory` or rank-card rows.
- Changes to gateway intents, antiRaid/info Discord verification-level logic, `handoff.md`, or any existing drizzle migration/snapshot.
- Deprecation warnings or compatibility shims for removed env vars and API routes.
- Replacing the removed preset with a new image or new shop item.
