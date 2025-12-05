# Multi-Bot Discord

A high-end, multi-purpose Discord bot built with Discord.js v14, TypeScript, PostgreSQL, and Lavalink.

## Features

- 🛡️ **Moderation** - Warnings, bans, kicks, auto-mod, anti-raid
- 🎵 **Music** - Multi-source playback with Lavalink (Spotify, SoundCloud, YouTube Music)
- 📊 **Leveling** - XP system, rank cards, leaderboards, role rewards
- 💰 **Economy** - Virtual currency, shop, gambling games
- 🎉 **Giveaways** - Create and manage giveaways
- 📱 **Social Feeds** - Twitch, YouTube, Reddit notifications
- ⚙️ **Auto Responders** - Custom triggers and commands

## Tech Stack

- **Runtime**: Node.js 20+
- **Language**: TypeScript 5.x
- **Framework**: Discord.js v14
- **Database**: PostgreSQL with Drizzle ORM
- **Music**: Lavalink with Shoukaku/Kazagumo
- **Logging**: Pino

## Getting Started

### Prerequisites

- Node.js 20 or higher
- PostgreSQL database
- Lavalink server (for music features)

### Installation

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

6. Start in development mode:
```bash
npm run dev
```

### Production

1. Build the project:
```bash
npm run build
```

2. Start the bot:
```bash
npm start
```

## Project Structure

```
src/
├── commands/           # Slash command handlers
│   ├── moderation/     # Moderation commands
│   ├── music/          # Music commands
│   ├── leveling/       # Leveling commands
│   ├── economy/        # Economy commands
│   └── utility/        # Utility commands
├── events/             # Discord event handlers
├── db/                 # Database connection and schema
│   └── schema/         # Drizzle ORM schemas
├── structures/         # Core bot structures
├── types/              # TypeScript type definitions
├── utils/              # Utility functions
├── config/             # Configuration management
└── index.ts            # Entry point
```

## Commands

### Utility
- `/ping` - Check bot latency
- `/help [command]` - Get help information

### Moderation
- `/warn <user> <reason>` - Warn a user
- `/warnings <user>` - View user warnings
- `/clearwarnings <user>` - Clear all warnings

### Music
- `/play <query>` - Play a song
- `/queue [page]` - View the queue
- `/skip` - Skip current song
- `/stop` - Stop and clear queue
- `/pause` - Pause playback
- `/resume` - Resume playback

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DISCORD_TOKEN` | Discord bot token | Yes |
| `DISCORD_CLIENT_ID` | Discord application ID | Yes |
| `DISCORD_DEV_GUILD_ID` | Dev guild for faster command updates | No |
| `DATABASE_URL` | PostgreSQL connection URL | Yes |
| `LAVALINK_HOST` | Lavalink server host | Yes |
| `LAVALINK_PORT` | Lavalink server port | Yes |
| `LAVALINK_PASSWORD` | Lavalink server password | Yes |

## License

MIT
