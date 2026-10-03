# Plan: Sleeker, more consistent bot UI

Spec: Kiana asked for the bot's UI (above all the features from #95) to look cleaner and sleeker. No behavior, command, option or custom ID changes; only how replies, cards and panels look.
Status: in-progress

## Design

The bot already uses Components V2 through `src/lib/components.ts`. The polish happens there first so it reaches every command, then the #95 views get hand-tuned layouts.

1. **Palette** (`Colors` in `components.ts`): move to Discord's current palette. Success `0x23a55a`, Error `0xf23f43`, Warning `0xf0b232`, Voice `0x5865f2`. `Info` becomes the brand accent `BRAND_COLOR` (new in `src/lib/brand.ts`, a soft violet `0x8b7cf6`) so informational cards get a visible, consistent accent instead of an invisible grey bar. `Neutral` keeps `0x2b2d31` for minor/loading states. Other colors unchanged.
2. **Status replies** (`errorReply`, `successReply`, `warningReply`, `loadingReply`): one-line messages render as today. When a message has more than one line, the first line becomes a bold title (trailing `.` dropped), the rest is the body, and any `-#` hint lines move to the end, separated from the body by a blank line. Signatures stay the same.
3. **New helpers** in `components.ts`:
   - `fields(pairs: [label, value][])` → `**Label** value` lines (reuses `field`).
   - `hint(...lines)` → TextDisplay of `-# ` lines (one per line, not one dotted run-on line).
   - `spacer()` → `SeparatorBuilder` without a divider (breathing room inside a card).
   - `headerSection({ title, subtitle?, thumbnailUrl? })` → `SectionBuilder` with `### title`, optional `-# subtitle`, and a thumbnail accessory when a URL is given (falls back to a TextDisplay when there is no thumbnail, since a Section needs an accessory).
   - `chips(items)` → inline code chips joined by spaces (`` `a` `b` ``), for short keyword lists.
4. **View rules** applied to the #95 features: header, then content, then a `-#` hint at the very end; separators only between real groups; no em-dash in headers (`Invites — kiana` becomes a header section with the user's avatar); lists lead with the item's name, metadata goes on a `-#` line under it.

5. **Music player** (follow-up ask from Kiana): the Now Playing card drops its header and divider for a compact block: a `-# Now playing` / `-# Paused` eyebrow, the track as a `###` link, artist · album, then one `-#` meta line (time, requester, up-next count, autoplay). Paused uses the Neutral accent instead of Warning. Controls: only play/pause (and loop when active) are Primary; stop becomes Secondary; the Options menu gets emoji and short descriptions. The idle jukebox reads `### Nothing playing`. `/queue` and the queue button share one builder: the current track as a section with artwork, then up-next items as a link line with an `-# artist · duration` line under it, footer hint for count, time left, loop and autoplay. History and playlists use the same item format. Channel notices (queue finished, disconnected, inactivity) lose dangling separators and em-dashes. No progress bars (existing rule), no custom ID changes.

## Tasks

| # | Task | File set | Tier | Status |
|---|------|----------|------|--------|
| 1 | Palette, `BRAND_COLOR`, status reply structure, new helpers (design items 1-3) + unit tests for the status formatter and helpers | `src/lib/components.ts`, `src/lib/brand.ts`, `src/lib/components.test.ts` (new) | heavy | done |
| 2 | Restyle #95 views per design item 4: verification (panel, captcha card, setup/view), highlights (list as chips, DM card), invites (view with avatar header section, inviter, leaderboard with top-3 medals, rewards list), role persistence view, schedule list + schedule confirmation, leveling multiplier list / boost / view | `src/lib/VerificationUtil.ts`, `src/commands/config/verification.ts`, `src/listeners/verification/interactionCreate.ts`, `src/commands/general/highlight.ts`, `src/lib/HighlightUtil.ts`, `src/commands/general/invites.ts`, `src/commands/general/invitesadmin.ts`, `src/lib/InviteTrackingUtil.ts`, `src/commands/config/rolepersist.ts`, `src/commands/moderation/schedule.ts`, `src/listeners/announcements/scheduleModal.ts`, `src/lib/config/handlers/levelconfig.ts` | heavy | done |
| 3 | Replace plain-text `❌`/`✅` content replies with the shared status replies | `src/listeners/fun/gameInteractions.ts`, `src/lib/config/handlers/presets.ts` | normal | done |
| 4 | Music player polish (design item 5) | `src/lib/components.ts` (music card section), `src/lib/components.test.ts`, `src/listeners/music/events.ts`, `src/listeners/music/buttonInteractions.ts` (queue view only), `src/lib/music/handlers/{nowplaying,queue,history,playlist}.ts`, new `src/lib/music/queueCard.ts` | heavy | done |

## Verification
- `bun run verify` and `bun run evals`
- Before/after screenshots of real handler output (rendered from captured payloads) attached to the PR.

## Deviations
- Task 1 (`formatStatus`, revised after render review): the title renders as `### title` instead of bold, and is applied only when at least one non-hint body line follows and the first line contains no `**` (so "sentence\n-# hint" stays a plain sentence with the hint after a blank line). Ellipsis titles stay intact (`Loading...`); only one trailing `.` or `:` is dropped. A blank first line is not titled.
- Task 2: the highlight DM header (`### keyword`) is added as its own TextDisplay instead of through `makeContainer({ header })`, because `plainHeader()` would strip a keyword's leading emoji. Same rendered layout.
- Task 2: the schedule list title is now bold, so it goes through `escapeMarkdown` (before it sat unescaped in a `-#` line); markdown in a heading shows literally in the list.
- Task 2: the scheduled-announcement confirmation shows the first run as plain timestamps (`<t:..:F> (<t:..:R>)`), not wrapped in inline code, since code formatting stops timestamps from rendering.
- Task 2: `/leveling multiplier list` entries use ` · ` instead of ` — ` between target and percent. The voice XP settings reply in `levelconfig.ts` (`parts.join(' • ')`) was left as is (not in the task's layouts).
- Task 2: the verification captcha card's header and body copy changed, and the verification panel text was reworded.
- Task 2: the invite rewards list header dropped its count; the count moved to the hint line.
- Task 2: the empty states of the schedule list and the leveling multiplier list moved from error replies to warning replies.
- Task 1: `formatStatus` titles apply bot-wide to every multi-line status reply, not only the #95 views. Intended; spot-checked `boost.ts`, `serverstats.ts` and the `admin.ts` reload reply.
- Task 4: new exported helpers in `components.ts`: `trackLink(title, uri, maxLength = 80)` (escapes markdown and `[`/`]`, cuts long titles with `…`, links only http(s) URIs and encodes `(`/`)`), `escapeTrackText()` and `TRACK_TITLE_MAX`. `queueCard.ts` also exports `trackItemLines()` / `trackMetaLine()`, reused by history and playlist view.
- Task 4: `musicTrackCard` renders a plain TextDisplay instead of a Section when there is no artwork (a Section needs an accessory). `/nowplaying` no longer prints `Requested by Unknown` when the requester is missing.
- Task 4: queue, history and playlist lists stay within a ~3200 character list budget: an item that would overflow loses its link, then the list stops with `-# … and N more`. History has no other cap.
- Task 4: the queue footer is two hint lines: `N tracks · M:SS left` (`N matches` for a search), then `Page X of Y · Loop: queue · Autoplay`. Stream durations no longer count toward time left. The `/queue` empty-search text quotes the query as typed (escaped), not lowercased.
- Task 4: the trackException / trackStuck notices also lost their em-dashes (`Couldn't play **x**, so I skipped it.` / `**x** got stuck, so I skipped it.`). The voice channel status text (`Title — Artist`) keeps its em-dash; it is not a card.
- Task 4: filter option descriptions: Bassboost 'Boost the low end', Nightcore 'Faster, higher pitch', Vaporwave 'Slower, lower pitch'. Playlist view header is `### name` (markdown escaped) instead of `makeContainer({ header })`, so a leading emoji in a playlist name is kept.
- Task 4 (review): the now-playing byline also goes through a new `escapeLineStart()` so a leading `#`/`-`/`>`/`1.` in an artist name can't render as a heading, list or quote. A `/queue` search with results shows `-# Matching "query"` under the 'Search results' header.
