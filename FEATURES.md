# Erica — Feature List

AloraMC's Discord moderation and community bot (Erica). Modules can be toggled per guild with `/module` or `/config modules` (bot owners: `/admin modules`).

---

## Getting started

| Command | What it does |
|---|---|
| `/help` | Role-aware help (`member` / `staff` / `admin` / `owner`) |
| `/info` | server, user, role, channel, ping, avatar, banner, emoji, permissions, invite, servericon |
| `/snipe deleted` / `edited` | Recently deleted or edited messages |
| `/quote` (+ context menu) | Quote a message by link |
| `/tools` | timestamp, color, calc, base64, firstmessage, inrole, boosters, **translate**, **weather** |
| `/emoji steal` / `enlarge` | Steal or enlarge custom emojis |

Create a tag named **`faq`** — welcome messages get a **Server FAQ / Guide** button that shows it.

---

## Levels & economy

| Command | What it does |
|---|---|
| `/level` | Rank card, leaderboard, staff XP tools |
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

## Music / Community / Minecraft / Tickets / Moderation

Unchanged core: music, afk, remind, birthday, poll, suggest, giveaway, tag, starboard, counting, feeds, tempvoice, sticky, autoresponder, reactionrole, stats, minecraft, tickets (stats now show **claimed**), full mod suite.

**New staff channel tools:** `/nuke`, `/clone`, `/afkchannel`

---

## Bot owner

`/admin` — blacklist, modules, **db** CRUD, info, guilds, leave, say, dm, reload, presence, invite, lookup, maintenance

---

## HTTP API

`GET /api/transcripts/:code` — serves saved HTML (or TXT) from `data/transcripts/` when `BOT_API_ENABLED=true` + secret.
