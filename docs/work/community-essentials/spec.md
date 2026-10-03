# Spec: Community essentials (seven quick-win features)

Intent: docs/work/community-essentials/intent.md
Status: approved (build requested by Kiana, 2026-10-02; review on the PR)

All new commands follow the existing split: staff/config commands use `requiredUserPermissions: [ManageGuild]`, `preconditions: ['Moderation']` and `.setDefaultMemberPermissions(ManageGuild)`; member commands have no default permissions. Every reply is CV2 or uses the `errorReply` / `successReply` / `warningReply` helpers, ephemeral via `flags: MessageFlags.Ephemeral`. Buttons and modals use namespaced custom IDs and swallow 10062/40060.

## Schema (one migration, task T1)

New module columns on `guild_modules` (guild default) and `global_modules` (always default true), added to `MODULES` + `MODULE_LABELS` (24 modules total, under the 25-choice limit) and to the module defaults in `GuildConfigApi.ts`:

| Key | Column | Guild default | Label |
|---|---|---|---|
| `verification` | `verification` | false | Member Verification |
| `rolePersistence` | `role_persistence` | false | Role Persistence |
| `inviteTracking` | `invite_tracking` | true | Invite Tracking |
| `highlights` | `highlights` | true | Highlights |

(`verification` was dropped in 0003; re-adding it in 0004 is intended.)

New tables (all ids `varchar(64)`, epoch-ms as `bigint(..., { mode: 'number' })`):

- `verification_settings`: `guild_id` PK, `role_id` null, `unverified_role_id` null, `captcha_enabled` bool default false, `min_account_age_days` int default 0, `panel_channel_id` null, `panel_message_id` null.
- `role_persistence_settings`: `guild_id` PK, `ignored_role_ids` text default `'[]'`, `restore_nickname` bool default false.
- `member_role_snapshots`: `id` autoincrement PK, `guild_id`, `user_id`, `role_ids` text default `'[]'`, `nickname` varchar(64) null, `saved_at` bigint ms; unique (`guild_id`, `user_id`).
- `invite_joins`: `id` PK, `guild_id`, `user_id`, `inviter_id` null, `invite_code` varchar(64) null, `joined_at` bigint ms, `left_at` bigint ms null, `fake` bool default false; index (`guild_id`, `inviter_id`), index (`guild_id`, `user_id`).
- `invite_rewards`: `id` PK, `guild_id`, `invites` int, `role_id`; unique (`guild_id`, `invites`, `role_id`).
- `level_multipliers`: `id` PK, `guild_id`, `target_type` varchar(16) (`'role' | 'channel'`), `target_id`, `percent` int; unique (`guild_id`, `target_type`, `target_id`).
- `scheduled_announcements`: `id` PK, `guild_id`, `channel_id`, `created_by`, `heading` varchar(256) null, `body` text, `color` varchar(32) default `'blue'`, `ping_type` varchar(1) null (`'r' | 'u'`), `ping_id` null, `next_run_at` bigint ms, `interval_ms` bigint null, `active` bool default true, `last_sent_at` bigint ms null, `created_at` bigint ms.
- `highlights`: `id` PK, `guild_id`, `user_id`, `keyword` varchar(64); unique (`guild_id`, `user_id`, `keyword`).

New columns:
- `automod_settings`: `phishing_enabled` bool default false, `phishing_action` varchar(255) default `'delete_timeout'`, `phishing_timeout_minutes` int default 60.
- `level_settings`: `boost_percent` int default 100, `boost_ends_at` bigint ms null.

`scripts/migrate-sqlite-to-mysql.ts` only needs a change if it enumerates tables/columns in a way the new ones break.

## 1. Verification gate

Behavior:
- `/verification setup role:<role> [unverified-role:<role>] [captcha:<bool>] [min-account-age:<0-365 days>]`: validates both roles are assignable (not `@everyone`, not managed, below the bot's highest role), upserts settings, turns the `verification` module on for the guild (note in reply if globally disabled), replies with a summary.
- `/verification panel [channel]`: requires a configured role; posts a CV2 panel (header "Verification", short instruction text, a `Verify` button `verification:start`) and stores the panel channel/message IDs.
- `/verification view`: shows role, unverified role, captcha, min age, panel location, module state.
- Button `verification:start`: module off or no role → ephemeral error. Member already has the role → ephemeral "already verified". Account younger than `min_account_age_days` → ephemeral error naming the requirement, plus a `sendLog` "Verification Blocked" entry. Captcha off → grant. Captcha on → ephemeral CV2 reply with a PNG captcha (MediaGallery, `attachment://captcha.png`) and an `Enter code` button `verification:code`; the code is held in memory per `guildId:userId` for 5 minutes.
- Button `verification:code` → `showModal()` as the sole response (text input, 5 chars). Modal `verification:modal` → case-insensitive compare; wrong → ephemeral error, three wrong attempts discard the code (click Verify again); expired/missing → ephemeral error telling them to click Verify again; correct → grant.
- Grant = add `role_id`, remove `unverified_role_id` if set, ephemeral success, `sendLog` "Member Verified". Role errors → ephemeral error asking staff to check the role hierarchy.
- New listener on `GuildMemberAdd`: module on + `unverified_role_id` set + not a bot → add the unverified role.

Design: `src/lib/VerificationUtil.ts` (settings get/upsert, `generateCaptchaCode()` from an unambiguous alphabet without 0/O/1/I/L, `renderCaptcha(code)` via `@napi-rs/canvas` with noise lines/dots and rotated glyphs, pending-code store, `grantVerification(member, settings)`), `src/commands/config/verification.ts`, `src/listeners/verification/{interactionCreate,guildMemberAdd}.ts`. Unit test for `generateCaptchaCode`.

## 2. Role persistence

Behavior:
- On `GuildMemberRemove` with the module on and a non-partial member: save roles except `@everyone`, managed roles and ignored roles, plus the nickname; upsert by (guild, user). If nothing to save, delete any existing snapshot. Partial members (roles unknown) are skipped.
- On `GuildMemberAdd` with the module on and a snapshot: restore roles that still exist, are not managed, are below the bot's highest role, are not ignored, and do not have `Administrator`, in one `roles.add(..., 'Role persistence')` call; restore the nickname if `restore_nickname`; delete the snapshot; `sendLog` "Roles Restored" listing restored roles. Errors are logged, never thrown. Bots are skipped.
- `/rolepersist view | ignore-add role | ignore-remove role | nickname enabled:<bool> | clear user:<user>` (staff). `view` shows module state with the `/module enable` hint, ignored roles and the nickname option. `clear` deletes a saved snapshot for any user ID.

Design: `src/lib/RolePersistUtil.ts` (settings, snapshot save/restore, pure `filterRestorableRoleIds` helper with a unit test), `src/listeners/rolePersist/{guildMemberRemove,guildMemberAdd}.ts`, `src/commands/config/rolepersist.ts`.

## 3. Invite tracking

Behavior:
- `InviteUtil.ts` gains `getJoinInvite(member)`: memoizes `detectUsedInvite(guild)` per `guildId:userId` for 60 seconds so the join logger and invite tracker share one detection (calling `detectUsedInvite` twice per join would break the second). `src/listeners/logging/guildMemberAdd.ts` switches to it; its output is unchanged. The invite cache must stay current regardless of which modules are on.
- On join (module on, not a bot): insert an `invite_joins` row with the inviter and code (null when unknown or vanity), `fake = account younger than 7 days`. If there is an inviter, compute their effective invites and grant every `invite_rewards` role with `invites <= effective` they lack (fetch the inviter member; skip if gone; ignore role errors).
- On leave (module on): set `left_at` on the member's latest open row.
- Counts for an inviter: joins = rows; left = rows with `left_at`; fake = rows with `fake`; effective = rows with no `left_at` and not fake.
- `/invites view [user]` (default self): effective, joins, left, fake, and who invited that user. `/invites leaderboard`: top inviters by effective count, paginated with the existing pagination helpers if they fit, else top 10. `/invites inviter user:<user>`: who invited them, with code and `<t:..:R>`.
- `/invitesadmin reward-add invites:<1-10000> role` (role must be assignable), `reward-remove invites role`, `reward-list`, `reset user:<user>` (deletes that inviter's rows).
- Module off → commands reply that Invite Tracking is off with the `/module enable` hint.
- Note in `/invites view` when the bot lacks Manage Server (cannot read invites).

Design: `src/lib/InviteTrackingUtil.ts` (queries, counts, rewards), `src/listeners/invites/{guildMemberAdd,guildMemberRemove}.ts`, `src/commands/general/invites.ts`, `src/commands/general/invitesadmin.ts`, edits to `src/lib/InviteUtil.ts` and `src/listeners/logging/guildMemberAdd.ts` (plus invite create/delete listeners only if needed to keep the cache current).

## 4. Scam / phishing link filter

Behavior:
- New automod rule `phishing` ("Scam / Phishing Links"), default action `delete_timeout`, 60 minutes. Toggled and configured through the existing `/automod toggle` / `/automod configure` (action + timeout; no threshold). Shown in `/automod` status with list size and last refresh time.
- Checked first among content rules (after the existing exemptions and admin bypass). A hit is any URL host (or parent domain, `www.` stripped) on the list, unless the host is on the guild's link whitelist. Reason: `Message contained a known scam link (<domain>)`.
- The list is fetched on ready and every 6 hours from `PHISHING_LIST_URL` (default `https://raw.githubusercontent.com/Discord-AntiScam/scam-links/main/list.json`, a JSON array of domains; newline-separated text is also accepted), with `User-Agent: USER_AGENT` and a 15 s timeout. A failed refresh keeps the previous list and logs a warning. With an empty list the rule never fires.

Design: `src/lib/PhishingUtil.ts` (list state, `refreshPhishingList()`, pure `extractUrlHosts(content)` and `findPhishingDomain(content, set, whitelist)`), `src/lib/PhishingUtil.test.ts`, `src/listeners/moderation/phishingListRefresh.ts` (ClientReady once + interval), edits to `src/lib/AutomodUtil.ts` and `src/commands/config/automod.ts`, `.env.example` entry.

## 5. XP multipliers and boosts

Behavior:
- Effective multiplier = (highest role percent among the member's roles, default 100) × (channel percent, checking a thread's parent too, default 100) × (boost percent while `boost_ends_at > now`, else 100), divided out to a factor and capped at 5×. Applied to message XP (`tryAddXp`) and voice XP (`addVoiceXp`, using the voice channel).
- `/leveling multiplier set-role role percent:<10-500>`, `set-channel channel percent:<10-500>`, `remove [role] [channel]`, `list`. Percent is explained as "150 = 1.5x".
- `/leveling boost start percent:<110-500> duration:<text>` (parseDuration, max 7 days; reply shows `<t:..:R>` end), `/leveling boost stop`.
- `/leveling view` shows the number of multipliers and any active boost.

Design: `getXpMultiplier(guildId, member, channelId, settings)` in `src/lib/LevelingUtil.ts` with a 60 s per-guild multiplier cache invalidated on change, pure `combineMultipliers(...)` with a unit test; edits to `src/listeners/leveling/{messageCreate,voiceStateUpdate}.ts`, `src/commands/config/leveling.ts`, and `src/lib/config/handlers/levelconfig.ts` if handlers live there.

## 6. Scheduled announcements

Behavior:
- `/schedule create channel in:<duration> [every:<duration>] [ping] [color]` (staff): validates `in` (1 minute to 365 days), `every` (at least 10 minutes), at most 25 active schedules per guild, and the same ping permission rule as `/mod announce`; then `showModal()` as the sole response (heading optional, body required, same fields as the announce modal). Validation errors use `interaction.reply` ephemeral (no defer before a modal). Pending options are kept in memory per user for 15 minutes under a short nonce in the custom ID `schedule_modal:<nonce>`.
- Modal submit: re-check Manage Server, insert the row, ephemeral success with id and `<t:..:F>` of the first run.
- `/schedule list`: active schedules with id, channel, next run, repeat interval, and the heading or first line of the body. `/schedule delete id`: guild-scoped delete.
- Scheduler (ClientReady once, every 30 s, re-entrancy guard like the reminder scheduler): for each active row with `next_run_at <= now`, send the ping (if any) then the CV2 container (same look as `/mod announce`, footer `-# Scheduled by <@creator>`, `allowedMentions: { parse: [] }` on the container). Success: recurring rows advance `next_run_at` past now by whole intervals and set `last_sent_at`; one-off rows set `active = false`. Undeliverable errors (10003, 10004, 50001, 50013) deactivate the row with a warning. Updates are guarded on the old `next_run_at` so a run never sends twice.

Design: `src/lib/AnnouncementUtil.ts` holds `ANNOUNCE_COLOR_PRESETS` (moved from `mod.ts`, which imports it from there), the container builder, ping builder and ping permission check. `src/listeners/moderation/announceModal.ts` is refactored onto it with unchanged behavior. New `src/commands/moderation/schedule.ts`, `src/listeners/announcements/{scheduleModal,scheduler}.ts`.

## 7. Highlights

Behavior:
- `/highlight add keyword:<2-32 chars>` (stored trimmed + lowercase; max 10 per member per guild), `remove keyword` (autocomplete from own list), `list`, `clear`. All ephemeral; module off → error with hint. `add` notes that DMs must be open.
- On a guild message (not from a bot, non-empty): record the author's activity in that channel; then, with the module on, find members whose keyword appears as a whole word (case-insensitive). Skip the author, members mentioned in the message, members who posted in that channel in the last 5 minutes, members notified for that channel in the last 5 minutes, members not in the guild, members who can't view and read history in the channel, and blacklisted users. DM a CV2 container: header "Highlight", "**keyword** was mentioned in <#channel> by <@author>", the message content quoted and truncated to 500 chars, and a link button to the message. `allowedMentions: { parse: [] }`; DM failures are ignored.
- Guild keyword lists are cached for 60 s and invalidated on change; activity/cooldown maps are pruned so they stay bounded.

Design: `src/lib/HighlightUtil.ts` (CRUD, cache, trackers, pure `findHighlightMatches(content, entries, authorId)` with a unit test), `src/listeners/highlights/messageCreate.ts`, `src/commands/general/highlight.ts`.

## Docs (task T9)
`/help` gains the new commands (members: `/highlight`, `/invites`; staff/admin: `/verification`, `/rolepersist`, `/invitesadmin`, `/schedule`, `/leveling multiplier|boost`, automod phishing rule). `FEATURES.md` and `README.md` describe the features; `CLAUDE.md` mentions the new toggleable modules; `.env.example` documents `PHISHING_LIST_URL` (T4).

## Policy checklist
- [x] CV2 only (no `content` with IsComponentsV2); ephemeral via flags. Pings are sent as a separate plain message before the CV2 container, as `/mod announce` does.
- [x] Select menus: update() first; showModal() sole response; 10062/40060 swallowed
- [x] Branding/addresses from src/lib/brand.ts (`USER_AGENT` for the list fetch, `BOT_NAME` if the bot is named)
- [x] Logging via sendLog / sendModLog (automod hits go through the existing automod mod-log path)
- [x] New migration only; existing migrations untouched

## Policy conflicts
None.

## Acceptance criteria
- AC1 `bun run verify` passes; exactly one new `drizzle/0004_*.sql` plus `_journal.json` entry and `0004_snapshot.json`; existing migrations/snapshots byte-identical.
- AC2 `/module list` shows the four new modules; `verification` and `rolePersistence` default off, `inviteTracking` and `highlights` default on.
- AC3 Verification: setup, panel, button grant without captcha, captcha image + modal flow with 3-attempt limit, min-age block, unverified role on join and removal on verify.
- AC4 Role persistence: roles saved on leave and restored on rejoin with the filters above; ignore list and `clear` work.
- AC5 Invites: rows recorded on join/leave; counts and leaderboard correct; rewards granted at milestones; join log output unchanged and invite detection runs once per join.
- AC6 Phishing: rule toggles/configures via `/automod`; a message containing a listed domain (or subdomain of one) is actioned; whitelisted hosts are not; failed refresh keeps the old list.
- AC7 Multipliers: role/channel/boost multipliers change XP for messages and voice; capped at 5×; `/leveling view` shows them.
- AC8 Schedules: one-off fires once; recurring advances without double sends; undeliverable deactivates; `/mod announce` behaves exactly as before.
- AC9 Highlights: DM sent under the stated conditions only; limits and cooldowns enforced.
- AC10 New unit tests for the pure helpers pass.

## Out of scope
- The other ten ideas in the survey (modmail, appeals, welcome cards, backups, seasonal leaderboards, etc.).
- Web dashboard/API endpoints for the new settings beyond module defaults.
- Coin rewards for invites; invite bonus adjustments.
