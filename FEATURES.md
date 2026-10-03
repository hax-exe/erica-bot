# Erica — Feature List

Erica — a Discord moderation and community bot. Modules can be toggled per guild with `/module` or `/config modules` (bot owners: `/admin modules`).

---

## Getting started

| Command | What it does |
|---|---|
| `/help` | Role-aware help (`member` / `staff` / `admin` / `owner`) |
| `/info` | server, user, role, channel, ping, avatar, banner, emoji, permissions, invite, servericon |
| `/snipe deleted` / `edited` | Recently deleted or edited messages |
| `/quote` (+ context menu) | Quote a message by link |
| `/tools` | timestamp, color, calc, base64, firstmessage, inrole, boosters, **translate**, **weather** |
| `/emoji enlarge` · `/emojiadmin steal` | Enlarge custom emojis · staff add emojis from other servers |

Create a tag named **`faq`** — welcome messages get a **Server FAQ / Guide** button that shows it.

---

## Levels & economy

| Command | What it does |
|---|---|
| `/level` · `/leveladmin` | Rank card, customize, leaderboard · staff XP set/add/remove/reset |
| `/economy` | Wallet: balance, daily/weekly/monthly, deposit/withdraw/pay, inventory/use, leaderboard/transactions |
| `/economy earn` | work, crime, rob, fish, mine, scavenge |
| `/economy shop` / `admin` | Shop items · staff give/take/reset |
| `/gamble` | **classic** slots/roulette/scratch/coinflip/blackjack · **quick** dice/rps/war/highlow · **table** baccarat/poker/sicbo/horse · **risk** crash/limbo/mines/tower/wheel/plinko · **tickets** lottery/keno · duel |

---

## Fun & games

| Command | What it does |
|---|---|
| `/fun games` | Connect 4, TTT, Trivia, RPS, 2048, Minesweeper, Find the Emoji, Wordle, Hangman, Blackjack, Truth or Dare, NHIE |
| `/fun` extras | 8ball, roll, ship, joke, WYR, animal, roast, **rate**, **mock**, **reverse**, **emojify**, **fact**, **advice**, **compliment**, **guess**, **higherlower** |
| `/fun story` / `rp` | Collaborative story + RP actions |

---

## Music / Community / Tickets / Moderation

Unchanged core: music, afk, remind, birthday, poll, suggest, giveaway, tag, starboard, counting, feeds, tempvoice, sticky, autoresponder, reactionrole, stats, tickets (stats now show **claimed**), full mod suite.

**New staff channel tools:** `/nuke`, `/clone`, `/afkchannel`

**Staff-only split commands** (hidden from members via default permissions): `/birthdayadmin`, `/tagadmin`, `/tempvoiceadmin`, `/musicadmin` (maxvolume)

---

## Community Essentials

Seven quick-win features for community servers (all optional, toggled per guild):

| Feature | Command | What it does |
|---|---|---|
| **Member Verification** | `/verification` | Gate member access with role assignment, optional CAPTCHA, min account age, and auto-assign unverified role on join |
| **Role Persistence** | `/rolepersist` | Save roles on leave, restore on rejoin (filters managed roles, ignored list, permissions) |
| **Invite Tracking** | `/invites` · `/invitesadmin` | Track joins by invite code, show who invited whom, reward roles at invite milestones, detect fake accounts |
| **Phishing Filter** | `/automod toggle phishing` | New automod rule: delete messages containing known scam links (configurable timeout, list fetches automatically) |
| **XP Multipliers** | `/leveling multiplier` · `/leveling boost` | Per-role and per-channel XP multipliers (10–500%), temporary server-wide boost (110–500%, up to 7 days) |
| **Scheduled Announcements** | `/schedule` | Recurring or one-time announcements (create, list, delete) with optional pings and color |
| **Highlights** | `/highlight` | Keyword alerts: DM when your keywords are mentioned in messages (max 10 keywords per member; at most one DM per channel every 5 minutes and 5 DMs every 10 minutes per member; at most 10 members alerted per message; messages with known scam links are never relayed) |

---

## Bot owner

`/admin` — blacklist, modules, **db** CRUD, info, guilds, leave, say, dm, reload, presence, invite, lookup, maintenance

---

## HTTP API

`GET /api/transcripts/:code` — serves saved HTML (or TXT) from `data/transcripts/` when `BOT_API_ENABLED=true` + secret.
