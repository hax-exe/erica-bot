# Plan: Community essentials (seven quick-win features)

Spec: docs/work/community-essentials/spec.md
Status: approved
<!-- allowed: draft, approved, in-progress, done -->

## Tasks

| # | Task | File set | Tier | Status |
|---|------|----------|------|--------|
| T1 | Schema, one migration, module registration | `src/db/schema.ts`, `drizzle/0004_*.sql`, `drizzle/meta/_journal.json`, `drizzle/meta/0004_snapshot.json`, `src/lib/ModuleUtil.ts`, `src/lib/GuildConfigApi.ts`, `scripts/migrate-sqlite-to-mysql.ts` | heavy | done |
| T2 | Verification gate | `src/lib/VerificationUtil.ts`, `src/lib/VerificationUtil.test.ts`, `src/commands/config/verification.ts`, `src/listeners/verification/*` | normal | todo |
| T3 | Role persistence | `src/lib/RolePersistUtil.ts`, `src/lib/RolePersistUtil.test.ts`, `src/commands/config/rolepersist.ts`, `src/listeners/rolePersist/*` | normal | todo |
| T4 | Invite tracking | `src/lib/InviteUtil.ts`, `src/lib/InviteTrackingUtil.ts`, `src/listeners/logging/guildMemberAdd.ts`, `src/listeners/logging/guildInviteCreate.ts`, `src/listeners/logging/guildInviteDelete.ts`, `src/listeners/invites/*`, `src/commands/general/invites.ts`, `src/commands/general/invitesadmin.ts` | normal | todo |
| T5 | Phishing rule | `src/lib/PhishingUtil.ts`, `src/lib/PhishingUtil.test.ts`, `src/lib/AutomodUtil.ts`, `src/commands/config/automod.ts`, `src/listeners/moderation/phishingListRefresh.ts`, `.env.example` | normal | todo |
| T6 | XP multipliers and boosts | `src/lib/LevelingUtil.ts`, `src/lib/LevelingUtil.test.ts`, `src/listeners/leveling/*`, `src/commands/config/leveling.ts`, `src/lib/config/handlers/levelconfig.ts` | normal | todo |
| T7 | Scheduled announcements | `src/lib/AnnouncementUtil.ts`, `src/commands/moderation/mod.ts`, `src/listeners/moderation/announceModal.ts`, `src/commands/moderation/schedule.ts`, `src/listeners/announcements/*` | heavy | todo |
| T8 | Highlights | `src/lib/HighlightUtil.ts`, `src/lib/HighlightUtil.test.ts`, `src/commands/general/highlight.ts`, `src/listeners/highlights/*` | normal | todo |
| T9 | Help and docs | `src/commands/general/help.ts`, `FEATURES.md`, `README.md`, `CLAUDE.md` | small | todo |

Order: T1 alone first (db:generate snapshots the whole schema). Then T2 to T8 in parallel (file sets are disjoint). T9 last.

While T2 to T8 run in parallel in one working tree, `bun run verify` can show errors from another task's half-finished files. Each implementer fixes errors in its own file set only and reports any it sees elsewhere; the verifier runs on the combined result.

## Verification
- `bun run verify` on the combined result.
- `migration-reviewer` on T1, `discord-interaction-reviewer` on T2 to T8, `spec-compliance-reviewer` on everything.
- No live Discord or MySQL in this environment: manual Discord checks (AC3 to AC9 flows) are listed in the PR for a human to run.

## Deviations
- T1: the migration is `drizzle/0004_reflective_brother_voodoo.sql` (8 CREATE TABLE, 13 ADD COLUMN, 2 CREATE INDEX). Migrations 0000 to 0003 and their snapshots are byte-identical.
- T1: `scripts/migrate-sqlite-to-mysql.ts` changed. It now copies only columns that exist in both the SQLite and the MySQL table, so the new NOT NULL columns (module toggles, phishing, boost) take their MySQL defaults instead of failing on NULL. `verification` stays in `SKIPPED_COLUMNS`: in old SQLite data it belongs to the retired Minecraft module (default on), and copying it would switch the opt-in Member Verification module on.
- T1: the schema also exports `LevelMultiplierTargetType` (`'role' | 'channel'`) and `AnnouncementPingType` (`'r' | 'u'`) for the `$type<>` columns. There is no index on `scheduled_announcements` because the spec lists none.
