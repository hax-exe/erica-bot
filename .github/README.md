<div align="center">

# 🌸 Erica Bot

**A feature-rich, high-performance Discord bot built for modern communities**

[![CI/CD](https://github.com/Hax-Exe/erica-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/Hax-Exe/erica-bot/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Discord.js](https://img.shields.io/badge/Discord.js-v14-5865F2?logo=discord&logoColor=white)](https://discord.js.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

[Features](#-features) • [Quick Start](#-quick-start) • [Commands](#-commands) • [Configuration](#-configuration) • [Development](#-development)

</div>

---

## ✨ Features

<table>
<tr>
<td width="50%">

### 🛡️ Moderation
Comprehensive tools to keep your server safe
- Warnings, kicks, bans, mutes
- Bulk message deletion
- Channel lock/slowmode
- Detailed audit logging

</td>
<td width="50%">

### 🎵 Music
High-quality audio streaming
- YouTube, Spotify, SoundCloud
- Queue management & looping
- Volume control & seeking
- Interactive search selection

</td>
</tr>
<tr>
<td width="50%">

### 📊 Leveling
Engage your community
- XP system with rank cards
- Server leaderboards
- Customizable role rewards
- Level-up announcements

</td>
<td width="50%">

### 💰 Economy
Virtual currency system
- Daily/work rewards
- Bank & wallet system
- Gambling (coinflip)
- Server shop

</td>
</tr>
<tr>
<td width="50%">

### 🎉 Giveaways
Easy giveaway management
- Timed giveaways
- Multiple winners
- Reroll support
- Button-based entry

</td>
<td width="50%">

### ⚙️ Auto Responders
Automated interactions
- Custom trigger words
- Flexible responses
- Regex support
- Easy management

</td>
</tr>
</table>

---

## 🚀 Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- Discord bot token from the [Developer Portal](https://discord.com/developers/applications)
- **Enable Privileged Intents**: Server Members Intent + Message Content Intent

### Deploy in 3 Steps

```bash
# 1. Clone and configure
git clone https://github.com/Hax-Exe/erica-bot.git
cd erica-bot
cp .env.example .env
# Edit .env with your tokens

# 2. Start services
docker compose up -d

# 3. Initialize database
docker compose exec bot npm run db:push
```

**That's it!** View logs with `docker compose logs -f bot`

---

## 📖 Commands

<details>
<summary><b>🛡️ Moderation</b></summary>

| Command | Description |
|---------|-------------|
| `/warn <user> <reason>` | Warn a user |
| `/warnings <user>` | View user warnings |
| `/clearwarnings <user>` | Clear all warnings |
| `/kick <user> [reason]` | Kick a user |
| `/ban <user> [reason]` | Ban a user |
| `/unban <user>` | Unban a user |
| `/mute <user> <duration>` | Timeout a user |
| `/unmute <user>` | Remove timeout |
| `/purge <amount>` | Bulk delete messages |
| `/lock [channel]` | Lock a channel |
| `/unlock [channel]` | Unlock a channel |
| `/slowmode <seconds>` | Set channel slowmode |

</details>

<details>
<summary><b>🎵 Music</b></summary>

| Command | Description |
|---------|-------------|
| `/play <query>` | Play a song (YouTube, Spotify, SoundCloud) |
| `/queue [page]` | View the queue |
| `/nowplaying` | Show current track |
| `/skip` | Skip current song |
| `/stop` | Stop and clear queue |
| `/pause` / `/resume` | Control playback |
| `/volume <0-100>` | Adjust volume |
| `/seek <time>` | Seek to position |
| `/shuffle` | Shuffle the queue |
| `/loop <mode>` | Loop off/track/queue |
| `/remove <position>` | Remove from queue |
| `/clearqueue` | Clear entire queue |

</details>

<details>
<summary><b>📊 Leveling</b></summary>

| Command | Description |
|---------|-------------|
| `/rank [user]` | View rank card |
| `/leaderboard` | View XP leaderboard |
| `/givexp <user> <amount>` | Give XP (admin) |
| `/setlevel <user> <level>` | Set level (admin) |

</details>

<details>
<summary><b>💰 Economy</b></summary>

| Command | Description |
|---------|-------------|
| `/balance [user]` | Check balance |
| `/daily` | Claim daily reward |
| `/work` | Work for coins |
| `/pay <user> <amount>` | Send coins |
| `/deposit <amount\|all>` | Deposit to bank |
| `/withdraw <amount\|all>` | Withdraw from bank |
| `/coinflip <amount>` | Gamble coins |
| `/shop` | View/buy items |
| `/richest` | View leaderboard |

</details>

<details>
<summary><b>🎮 Fun & Utility</b></summary>

| Command | Description |
|---------|-------------|
| `/8ball <question>` | Ask the magic 8ball |
| `/avatar [user]` | Get user's avatar |
| `/choose <options>` | Choose between options |
| `/roll [dice]` | Roll dice (e.g., 2d6) |
| `/ping` | Check bot latency |
| `/help [command]` | Get help |
| `/serverinfo` | Server information |
| `/userinfo [user]` | User information |

</details>

<details>
<summary><b>🎉 Giveaways & Admin</b></summary>

| Command | Description |
|---------|-------------|
| `/giveaway start` | Start a giveaway |
| `/giveaway end` | End early |
| `/giveaway reroll` | Reroll winner |
| `/settings` | Configure server |
| `/autoresponder` | Manage auto responses |

</details>

---

## ⚙️ Configuration

### Environment Variables

<details>
<summary><b>Required Variables</b></summary>

| Variable | Description |
|----------|-------------|
| `DISCORD_TOKEN` | Bot token from Developer Portal |
| `DISCORD_CLIENT_ID` | Application ID |
| `DATABASE_URL` | PostgreSQL connection URL |
| `DB_PASSWORD` | Database password (Docker) |
| `LAVALINK_HOST` | Lavalink server host |
| `LAVALINK_PORT` | Lavalink port (default: 2333) |
| `LAVALINK_PASSWORD` | Lavalink password |

</details>

<details>
<summary><b>Optional Variables</b></summary>

| Variable | Description |
|----------|-------------|
| `DISCORD_DEV_GUILD_ID` | Dev guild for faster command updates |
| `SPOTIFY_CLIENT_ID` | Spotify API client ID |
| `SPOTIFY_CLIENT_SECRET` | Spotify API secret |
| `YOUTUBE_OAUTH_REFRESH_TOKEN` | YouTube OAuth token |
| `BOT_API_PORT` | API port (default: 3002) |
| `NODE_ENV` | Environment mode |
| `LOG_LEVEL` | Logging verbosity |

</details>

### Music Setup

<details>
<summary><b>YouTube OAuth (Recommended)</b></summary>

YouTube requires OAuth for reliable playback:

1. Start Lavalink and watch logs: `docker compose logs -f lavalink`
2. Look for device code prompt with URL
3. Sign in with a **burner Google account**
4. Copy refresh token to `.env` as `YOUTUBE_OAUTH_REFRESH_TOKEN`

</details>

<details>
<summary><b>Spotify Support</b></summary>

1. Create app at [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Add to `.env`:
   ```
   SPOTIFY_CLIENT_ID=your_client_id
   SPOTIFY_CLIENT_SECRET=your_client_secret
   ```

</details>

---

## 🔧 Development

### Local Development

```bash
# Start infrastructure only
docker compose -f docker-compose.dev.yml up -d

# Run bot with hot-reload
npm run dev
```

### Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start with hot reload |
| `npm run build` | Build for production |
| `npm start` | Run production build |
| `npm run lint` | Run ESLint |
| `npm test` | Run tests |
| `npm run db:push` | Push schema to DB |
| `npm run db:studio` | Open Drizzle Studio |
| `npm run deploy` | Deploy slash commands |

### Project Structure

```
src/
├── commands/          # Slash commands by category
│   ├── admin/         # Settings, autoresponder
│   ├── economy/       # Currency, shop, gambling
│   ├── fun/           # 8ball, avatar, dice
│   ├── giveaway/      # Giveaway management
│   ├── leveling/      # XP, ranks, leaderboard
│   ├── moderation/    # Ban, kick, warn, etc.
│   ├── music/         # Playback controls
│   └── utility/       # Help, ping, info
├── events/            # Discord event handlers
├── db/                # Database & Drizzle schemas
├── structures/        # Core bot classes
└── utils/             # Helpers & utilities
```

---

## 🔄 High Availability

Run multiple instances with automatic failover:

```bash
docker compose -f docker-compose.yml -f docker-compose.ha.yml up -d
```

- **Leader Election**: Redis-based single active instance
- **10-Second Failover**: Automatic standby promotion
- **Session Preservation**: Music state saved & restored

<details>
<summary><b>HA Configuration</b></summary>

| Variable | Default | Description |
|----------|---------|-------------|
| `HA_ENABLED` | `false` | Enable HA mode |
| `HA_INSTANCE_ID` | auto | Unique instance ID |
| `HA_HEARTBEAT_INTERVAL` | `3000` | Heartbeat (ms) |
| `HA_LEADER_TIMEOUT` | `10000` | Failover timeout (ms) |
| `REDIS_URL` | `redis://localhost:6379` | Redis URL |

</details>

---

## 🛠️ Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | [Node.js](https://nodejs.org/) 20+ |
| Language | [TypeScript](https://www.typescriptlang.org/) 5.x |
| Framework | [Discord.js](https://discord.js.org/) v14 |
| Database | [PostgreSQL](https://www.postgresql.org/) + [Drizzle ORM](https://orm.drizzle.team/) |
| Music | [Lavalink 4](https://github.com/lavalink-devs/Lavalink) + [Kazagumo](https://github.com/Takiyo0/kazagumo) |
| Caching | [Redis](https://redis.io/) |
| Logging | [Pino](https://github.com/pinojs/pino) |
| Testing | [Vitest](https://vitest.dev/) |
| CI/CD | [GitHub Actions](https://github.com/features/actions) |

---

<div align="center">

**[⬆ Back to Top](#-erica-bot)**

Made with 💜 by [hax-exe](https://github.com/hax-exe)

</div>
