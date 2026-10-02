import '@sapphire/plugin-logger/register';
import '@sapphire/plugin-subcommands/register';

import { join } from 'node:path';
import { ApplicationCommandRegistries, container, RegisterBehavior, SapphireClient } from '@sapphire/framework';
import { GatewayIntentBits, Partials } from 'discord.js';
import { Connectors } from 'moonlink.js';
import { startApiServer } from './lib/ApiServer.js';
import { closeDatabase } from './lib/database.js';
import { createMusicManager } from './lib/MusicManager.js';

// Fail fast with a clear message instead of discord.js's generic "invalid token" error at login.
// (DATABASE_URL is validated in lib/database.ts, which is evaluated as an import before this line.)
const discordToken = process.env.DISCORD_TOKEN?.trim();
if (!discordToken) {
	throw new Error('DISCORD_TOKEN is required (bot token from the Discord Developer Portal → your app → Bot)');
}

// Privileged intent — only request it when it is also enabled in the Developer Portal,
// otherwise Discord rejects the login (close code 4014).
const presenceIntentEnabled = process.env.DISCORD_PRESENCE_INTENT === 'true';

// Sync all slash commands every restart by bulk-overwriting
ApplicationCommandRegistries.setDefaultBehaviorWhenNotIdentical(RegisterBehavior.BulkOverwrite);

const client = new SapphireClient({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMembers,
		GatewayIntentBits.GuildModeration,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.GuildMessageReactions,
		GatewayIntentBits.GuildVoiceStates,
		GatewayIntentBits.GuildInvites,
		GatewayIntentBits.MessageContent,
		GatewayIntentBits.DirectMessages, // required to receive button/modal interactions from DM review requests
		GatewayIntentBits.GuildMessagePolls,
		GatewayIntentBits.GuildScheduledEvents, // scheduled event subscribe/unsubscribe logging
		// presenceUpdate logging + the "Online" server-stats counter
		...(presenceIntentEnabled ? [GatewayIntentBits.GuildPresences] : []),
	],
	partials: [
		Partials.GuildMember,
		Partials.Message,
		Partials.Channel,
		Partials.Reaction,
		Partials.Poll,
		Partials.PollAnswer,
	],
	logger: {
		level: process.env.NODE_ENV === 'production' ? 30 : 20, // info in prod, debug in dev
	},
	loadMessageCommandListeners: false,
	baseUserDirectory: join(__dirname),
});

// Set up Moonlink — the DiscordJs connector handles init() and raw packet forwarding
const music = createMusicManager();
music.use(new Connectors.DiscordJs(), client);
container.music = music;

const LOGIN_TIMEOUT_MS = 30_000;
let apiServer: ReturnType<typeof Bun.serve> | null = null;
let shuttingDown = false;

async function shutdown(signal: string, exitCode: number): Promise<void> {
	if (shuttingDown) return;
	shuttingDown = true;
	client.logger.info(`[shutdown] ${signal} received; shutting down cleanly.`);

	apiServer?.stop(true);
	await Promise.allSettled(music.players.all.map((player) => player.destroy()));
	client.destroy();
	await closeDatabase();
	process.exit(exitCode);
}

process.on('unhandledRejection', (reason) => {
	client.logger.error('[unhandledRejection]', reason);
});

process.on('uncaughtException', (error) => {
	client.logger.fatal('[uncaughtException]', error);
	void shutdown('uncaughtException', 1);
});
if (process.env.NODE_ENV === 'production') {
	process.once('SIGINT', () => void shutdown('SIGINT', 0));
	process.once('SIGTERM', () => void shutdown('SIGTERM', 0));
}

void (async () => {
	try {
		client.logger.info('Starting Erica...');
		const { loadTicketsConfig } = await import('./lib/TicketsConfig.js');
		loadTicketsConfig();
		client.logger.info('Loaded config/tickets.yml');
		const { loadStatusConfig } = await import('./lib/StatusUtil.js');
		loadStatusConfig();
		client.logger.info('Loaded config/status.yml');
		// Health is always served. Website/config routes remain opt-in.
		apiServer = startApiServer({ fullApiEnabled: process.env.BOT_API_ENABLED === 'true' });
		await Promise.race([
			client.login(discordToken),
			new Promise<never>((_, reject) =>
				setTimeout(
					() => reject(new Error('Discord login timed out after 30s — Discord may be unavailable')),
					LOGIN_TIMEOUT_MS,
				),
			),
		]);
	} catch (error) {
		client.logger.fatal(error);
		client.destroy();
		process.exit(1);
	}
})();
