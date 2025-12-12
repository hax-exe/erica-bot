# Multi-Bot Discord

A high-end, multi-purpose Discord bot built with Discord.js v14, TypeScript, PostgreSQL, and Lavalink.

## Features

- 🛡️ **Moderation** - Warnings, bans, kicks, mutes, purge, channel lock/unlock, slowmode
- 🎵 **Music** - Multi-source playback with Lavalink (YouTube, Spotify, SoundCloud)
- 📊 **Leveling** - XP system, rank cards, leaderboards, role rewards
- 💰 **Economy** - Virtual currency, daily rewards, shop, gambling games (coinflip)
- 🎉 **Giveaways** - Create and manage giveaways
- 🎮 **Fun** - 8ball, avatar lookup, choose, dice roll
- ⚙️ **Auto Responders** - Custom triggers and automated responses
- 🔧 **Admin** - Server settings and configuration

## Tech Stack

- **Runtime**: Node.js 20+
- **Language**: TypeScript 5.x
- **Framework**: Discord.js v14
- **Database**: PostgreSQL with Drizzle ORM
- **Music**: Lavalink 4 with Kazagumo/Shoukaku
- **Plugins**: LavaSrc (Spotify), YouTube Source (OAuth), LavaSearch
- **Logging**: Pino
- **Testing**: Vitest
- **CI/CD**: GitHub Actions with Docker image publishing

## Deployment

### Option 1: Docker (Recommended)

Docker deployment includes the bot, PostgreSQL database, and Lavalink server all configured to work together.

#### Prerequisites

- Docker and Docker Compose installed
- A Discord bot token and client ID from the [Discord Developer Portal](https://discord.com/developers/applications)

#### Quick Start

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd multi-bot-discord
   ```

2. Copy and configure environment variables:
   ```bash
   cp .env.example .env
   ```

3. Edit `.env` with your configuration (see [Environment Variables](#environment-variables))

4. Start the services:
   ```bash
   docker compose up -d
   ```

5. Push the database schema:
   ```bash
   docker compose exec bot npm run db:push
   ```

The bot will automatically connect and start running. View logs with:
```bash
docker compose logs -f bot
```

#### Using Pre-built Images

The CI/CD pipeline automatically builds and pushes multi-architecture Docker images (amd64/arm64) to GitHub Container Registry on every push to `main`.

```bash
# Pull the latest image
docker compose pull

# Start services
docker compose up -d
```

---

### Option 2: Standalone (Development)

Run the bot directly on your machine without Docker.

#### Prerequisites

- Node.js 20 or higher
- PostgreSQL database (local or remote)
- Lavalink server (for music features)

#### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd multi-bot-discord
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy the environment template:
   ```bash
   cp .env.example .env
   ```

4. Configure your `.env` file with:
   - Discord bot token and client ID
   - PostgreSQL connection string
   - Lavalink server details

5. Push the database schema:
   ```bash
   npm run db:push
   ```

6. Start in development mode (with hot reload):
   ```bash
   npm run dev
   ```

#### Production Build

1. Build the project:
   ```bash
   npm run build
   ```

2. Start the bot:
   ```bash
   npm start
   ```

---

## High Availability (Optional)

The bot supports High Availability (HA) mode with automatic failover. When enabled, you can run multiple bot instances where only one is active at a time (the "leader"), while others remain on standby ready to take over if the leader fails.

### How It Works

- **Leader Election**: Uses Redis to elect a single active instance
- **10-Second Failover**: If the leader stops sending heartbeats, a standby takes over
- **Music Session Preservation**: Active music sessions are saved to Redis and restored on failover

### Quick Start (HA Mode)

1. Ensure the base setup is working first (see Options 1 or 2 above)

2. Start with the HA override:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.ha.yml up -d
   ```

3. Verify both instances are running:
   ```bash
   # Check primary (should show isLeader: true)
   curl http://localhost:3002/health

   # Check standby (should show isLeader: false)
   curl http://localhost:3003/health
   ```

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `HA_ENABLED` | `false` | Enable HA mode |
| `HA_INSTANCE_ID` | auto | Unique instance ID |
| `HA_HEARTBEAT_INTERVAL` | `3000` | Heartbeat frequency (ms) |
| `HA_LEADER_TIMEOUT` | `10000` | Failover timeout (ms) |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |

### Testing Failover

```bash
# Kill the primary instance
docker stop discord-bot-primary

# Wait 10-15 seconds, then check standby
curl http://localhost:3003/health
# Should now show: "isLeader": true
```

### Limitations

- ~10-15 seconds of downtime during failover
- Music playback resumes from last saved position (may be a few seconds behind)
- If the track expired (YouTube), it will skip to the next in queue

---

## Setting Up Lavalink

If running standalone, you'll need a Lavalink server for music features.

### Using Docker (Standalone Lavalink)

```bash
docker run -d \
  --name lavalink \
  -p 2333:2333 \
  -v ./lavalink/application.yml:/opt/Lavalink/application.yml:ro \
  -e LAVALINK_PASSWORD=your_password \
  ghcr.io/lavalink-devs/lavalink:4
```

### YouTube OAuth Setup

YouTube requires OAuth authentication for reliable playback. To set this up:

1. Start Lavalink and watch the logs
2. Look for a device code prompt with a URL and code
3. Visit the URL and sign in with a **burner Google account**
4. Copy the refresh token to your `.env` as `YOUTUBE_OAUTH_REFRESH_TOKEN`

### Spotify Support

To enable Spotify link support:

1. Create an app at [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Add `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` to your `.env`

---

## Project Structure

```
├── src/
│   ├── commands/           # Slash command handlers
│   │   ├── admin/          # Server settings, autoresponder
│   │   ├── economy/        # Currency, shop, gambling
│   │   ├── fun/            # 8ball, avatar, choose, roll
│   │   ├── giveaway/       # Giveaway management
│   │   ├── leveling/       # XP, ranks, leaderboard
│   │   ├── moderation/     # Ban, kick, mute, warn, etc.
│   │   ├── music/          # Play, queue, skip, etc.
│   │   └── utility/        # Help, ping, info commands
│   ├── events/             # Discord event handlers
│   ├── db/                 # Database connection and schema
│   │   └── schema/         # Drizzle ORM schemas
│   ├── structures/         # Core bot structures
│   ├── types/              # TypeScript type definitions
│   ├── utils/              # Utility functions
│   ├── config/             # Configuration management
│   └── index.ts            # Entry point
├── lavalink/               # Lavalink configuration
│   └── application.yml     # Lavalink server config
├── tests/                  # Test files
├── docker-compose.yml      # Docker orchestration
├── Dockerfile              # Bot container image
└── .github/workflows/      # CI/CD pipeline
```

## Commands

### Utility
| Command | Description |
|---------|-------------|
| `/ping` | Check bot latency |
| `/help [command]` | Get help information |
| `/serverinfo` | Display server information |
| `/userinfo [user]` | Display user information |

### Moderation
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

### Music
| Command | Description |
|---------|-------------|
| `/play <query>` | Play a song (supports YouTube, Spotify, SoundCloud) |
| `/queue [page]` | View the queue |
| `/nowplaying` | Show current track info |
| `/skip` | Skip current song |
| `/stop` | Stop and clear queue |
| `/pause` | Pause playback |
| `/resume` | Resume playback |
| `/volume <0-100>` | Adjust volume |
| `/seek <time>` | Seek to position |
| `/shuffle` | Shuffle the queue |
| `/loop <mode>` | Set loop mode (off/track/queue) |
| `/remove <position>` | Remove track from queue |
| `/clearqueue` | Clear the entire queue |

### Leveling
| Command | Description |
|---------|-------------|
| `/rank [user]` | View rank card |
| `/leaderboard` | View XP leaderboard |
| `/givexp <user> <amount>` | Give XP to user (admin) |
| `/setlevel <user> <level>` | Set user level (admin) |

### Economy
| Command | Description |
|---------|-------------|
| `/balance [user]` | Check wallet and bank balance |
| `/daily` | Claim daily reward |
| `/work` | Work for coins |
| `/pay <user> <amount>` | Send coins to another user |
| `/deposit <amount>` | Deposit coins to bank |
| `/withdraw <amount>` | Withdraw coins from bank |
| `/coinflip <amount>` | Gamble coins |
| `/shop` | View and buy items |
| `/richest` | View richest users |

### Fun
| Command | Description |
|---------|-------------|
| `/8ball <question>` | Ask the magic 8ball |
| `/avatar [user]` | Get user's avatar |
| `/choose <options>` | Choose between options |
| `/roll [dice]` | Roll dice (e.g., 2d6) |

### Giveaways
| Command | Description |
|---------|-------------|
| `/giveaway start` | Start a giveaway |
| `/giveaway end` | End a giveaway early |
| `/giveaway reroll` | Reroll giveaway winner |

### Admin
| Command | Description |
|---------|-------------|
| `/settings` | Configure server settings |
| `/autoresponder` | Manage auto responses |

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DISCORD_TOKEN` | Discord bot token | Yes |
| `DISCORD_CLIENT_ID` | Discord application ID | Yes |
| `DISCORD_DEV_GUILD_ID` | Dev guild for faster command updates | No |
| `DATABASE_URL` | PostgreSQL connection URL | Yes |
| `DB_PASSWORD` | Database password (Docker only) | Docker |
| `LAVALINK_HOST` | Lavalink server host | Yes |
| `LAVALINK_PORT` | Lavalink server port (default: 2333) | Yes |
| `LAVALINK_PASSWORD` | Lavalink server password | Yes |
| `SPOTIFY_CLIENT_ID` | Spotify API client ID | No |
| `SPOTIFY_CLIENT_SECRET` | Spotify API client secret | No |
| `YOUTUBE_OAUTH_REFRESH_TOKEN` | YouTube OAuth refresh token | No |
| `BOT_API_PORT` | Bot API port (default: 3002) | No |
| `BOT_API_SECRET` | Shared secret for API auth | No |
| `NODE_ENV` | Environment (development/production) | No |
| `LOG_LEVEL` | Logging level (default: info) | No |

## Development

### Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start with hot reload |
| `npm run build` | Build for production |
| `npm start` | Run production build |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Fix ESLint issues |
| `npm test` | Run tests in watch mode |
| `npm run test:run` | Run tests once |
| `npm run test:coverage` | Run tests with coverage |
| `npm run db:push` | Push schema to database |
| `npm run db:generate` | Generate migrations |
| `npm run db:studio` | Open Drizzle Studio |
| `npm run deploy` | Deploy slash commands |

### CI/CD

The project uses GitHub Actions for continuous integration:

- **Test Job**: Runs linting, type checking, and tests on every push/PR
- **Build Job**: Compiles TypeScript and creates build artifacts
- **Docker Job**: Builds and pushes multi-arch images to GHCR (main branch only)

## License

MIT
