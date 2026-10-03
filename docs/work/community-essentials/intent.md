# Intent: Community essentials (seven quick-win features)

Slug: community-essentials
Status: approved (Kiana asked to implement the top-tier ideas in the project thread, 2026-10-02; review on the PR)

## Problem
Erica became a general-purpose community bot in 9f24ecf, which also removed its only member verification flow. A feature survey (`/mnt/project-files/ideas/erica-feature-ideas.md`, ranked list of 17) found seven high-value gaps that extend systems Erica already has:

1. No way to gate new members until they prove they're human.
2. Members can leave and rejoin to shed roles (including punishment roles).
3. The join log already knows who invited each member, but nothing is stored, counted or rewarded.
4. Automod's link filter is all-or-nothing; there is no protection against known scam/phishing domains.
5. Leveling has rates but no multipliers per role/channel and no timed double-XP events.
6. `/mod announce` only posts immediately; there is no scheduled or recurring announcement.
7. Members can't be notified when a keyword they care about is said (highlights).

## Desired outcome
- `/verification` sets up a button panel (optional image captcha, optional minimum account age, optional "unverified" role on join) that grants a configured role.
- With the Role Persistence module on, a member who leaves and rejoins gets their eligible roles back; staff can ignore roles and clear a member's snapshot.
- Joins are stored with their inviter; `/invites` shows counts (joins, left, fake), who invited a member and a leaderboard; staff can configure role rewards at invite milestones.
- A new automod rule `phishing` blocks messages linking to domains on a public scam-domain list, refreshed periodically.
- `/leveling multiplier` sets per-role and per-channel XP multipliers; `/leveling boost` starts a timed server-wide XP boost.
- `/schedule` queues one-off or recurring announcements that use the same look as `/mod announce`.
- `/highlight` lets members register keywords and get a DM when they're said in a channel they can see and aren't active in.

## Affected systems
- `src/db/schema.ts` + one new drizzle migration (new tables, new module columns, new automod/leveling columns).
- `src/lib/ModuleUtil.ts`, `src/lib/GuildConfigApi.ts` (new modules).
- Automod (`AutomodUtil.ts`, `/automod`), leveling (`LevelingUtil.ts`, leveling listeners, `/leveling`), announcements (`/mod announce`, `announceModal.ts`), invites (`InviteUtil.ts`, join logging).
- New commands, listeners and lib files per feature; `/help`, `FEATURES.md`, `README.md`, `CLAUDE.md`, `.env.example`.

## Constraints
- CLAUDE.md conventions: Bun only, CV2 (`IsComponentsV2`, never with `content`), `flags: MessageFlags.Ephemeral`, select menus update-first, `showModal()` as sole response, swallow 10062/40060, branding from `brand.ts`, logs via `sendLog`/`sendModLog`.
- Exactly one new migration; existing migrations and snapshots untouched; ms durations/epoch timestamps as `bigint(..., { mode: 'number' })`.
- No new privileged intents.
- `MODULES` feeds slash-command choices (limit 25); it may grow to at most 25.
- Ideas only beyond these seven are out of scope (modmail, appeals, backups, etc.).

## Open questions
- None blocking. Defaults chosen are recorded in spec.md.
