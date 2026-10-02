import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { ActivityType, type Client, Events } from 'discord.js';
import { eq } from 'drizzle-orm';
import { BOT_NAME } from '../lib/brand.js';
import { db, schema } from '../lib/database.js';
import { cacheGuildInvites } from '../lib/InviteUtil.js';
import { syncWebhookBranding } from '../lib/LoggingUtil.js';

const PROD_STATUSES = [
	// --- Friendly & Community Focused ---
	'✨ Watching over the server',
	`🤖 Your friendly neighborhood ${BOT_NAME}`,
	'🧪 Fueled by potions and good intentions',
	'🪄 Making the server a little more magical every day',
	'❤️ Here to help. Always.',

	// --- Community Vibes ---
	'⛏️ Digging for hidden treasure',
	'🪵 Stacking logs and thinking about life',
	'🌌 Chasing gremlins out of the server',
	"📦 Organizing chests so you don't have to",
	'🛡️ Defending the lobby from stray spam',
	'🌾 Trading with merchants (and getting totally ripped off)',

	// --- Playful & Sarcastic Bot Humor ---
	"📜 Reading the server rules (so you don't have to)",
	'🍿 Listening to chat drama with a bucket of popcorn',
	'🤖 Beep boop. Definitely a real person.',
	'🛌 Thinking very hard about doing absolutely nothing',
	'⚡ Online, awake, and 99% lag-free!',
	'🕯️ Keeping the lights on around here',
];

const STATUS_INTERVAL_MS = 5 * 60 * 1000; // rotate every 5 minutes

@ApplyOptions<Listener.Options>({
	name: 'botReady',
	event: Events.ClientReady,
	once: true,
})
export class ReadyListener extends Listener<typeof Events.ClientReady> {
	private statusIndex = 0;

	public override async run(client: Client<true>) {
		const isDev = process.env.NODE_ENV === 'development';

		const applyPresence = () => {
			const state = isDev ? '🛠️ Doing Sus Things' : PROD_STATUSES[this.statusIndex % PROD_STATUSES.length];

			client.user.setPresence({
				status: isDev ? 'dnd' : 'online',
				activities: [
					{
						type: ActivityType.Custom,
						name: 'Custom Status',
						state,
					},
				],
			});
		};

		applyPresence();

		// Rotate statuses in prod
		if (!isDev) {
			setInterval(() => {
				this.statusIndex = (this.statusIndex + 1) % PROD_STATUSES.length;
				applyPresence();
			}, STATUS_INTERVAL_MS);
		}

		// Re-apply on shard reconnect (picks up whatever the current index is)
		client.on(Events.ShardResume, applyPresence);

		this.container.logger.info(`Logged in as ${client.user.tag}`);

		const webhookSync = await syncWebhookBranding().catch((err) => {
			this.container.logger.warn('[webhooks] Could not sync log webhook branding:', err);
			return null;
		});
		if (webhookSync && (webhookSync.updated || webhookSync.failed)) {
			const plural = (n: number) => `${n} log webhook${n === 1 ? '' : 's'}`;
			this.container.logger.info(
				`[webhooks] Synced ${BOT_NAME} branding on ${plural(webhookSync.updated)}` +
					(webhookSync.failed ? `; ${plural(webhookSync.failed)} could not be updated` : ''),
			);
		}

		// Clear stale guild-scoped slash commands
		for (const guild of client.guilds.cache.values()) {
			const guildCmds = await guild.commands.fetch().catch(() => null);
			if (guildCmds && guildCmds.size > 0) {
				await guild.commands.set([]).catch((err) => {
					this.container.logger.warn(`[Ready] failed to clear guild commands for ${guild.id}:`, err);
				});
				this.container.logger.info(`[Ready] cleared ${guildCmds.size} stale guild commands from ${guild.name}`);
			}
		}

		// Populate invite cache for all guilds
		for (const guild of client.guilds.cache.values()) {
			await cacheGuildInvites(guild);
		}

		// Restore autoplay preferences (Erica-owned — Moonlink autoPlay stays false)
		const { autoplayEnabled } = await import('../lib/AutoplayManager.js');
		const autoplayGuilds = await db.query.guilds
			.findMany({
				where: eq(schema.guilds.autoplayEnabled, true),
				columns: { id: true },
			})
			.catch(() => []);
		for (const g of autoplayGuilds) {
			autoplayEnabled.set(g.id, true);
		}

		// A restart starts music cleanly instead of reconnecting with a stale queue.
		await db
			.delete(schema.musicQueues)
			.then(() => this.container.logger.info('[Music] Cleared saved queues on restart'))
			.catch((err) => this.container.logger.error('[Music] Failed to clear saved queues on restart:', err));

		this.container.logger.info('Bot started successfully!');
	}
}
