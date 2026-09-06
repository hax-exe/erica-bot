import { Listener } from '@sapphire/framework';
import { type Message, PermissionFlagsBits } from 'discord.js';
import { eq } from 'drizzle-orm';
import { db, schema } from '../../lib/database.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';

// Per-channel cooldown (ms) to avoid re-posting on every single message in a busy channel.
const COOLDOWN_MS = 3_000;
const _cooldowns = new Map<string, number>();

export class StickyMessageListener extends Listener {
	public constructor(context: Listener.LoaderContext) {
		super(context, { event: 'messageCreate' });
	}

	public async run(message: Message) {
		if (!message.inGuild() || message.author.bot) return;
		if (!(await isModuleEnabled(message.guildId, 'sticky'))) return;

		// Ignore staff messages to prevent repost spam during staff conversation
		if (message.member?.permissions.has(PermissionFlagsBits.ModerateMembers)) return;

		const channelId = message.channelId;
		const now = Date.now();

		// Cooldown check — don't hammer the DB on every message
		if (now - (_cooldowns.get(channelId) ?? 0) < COOLDOWN_MS) return;

		const row = await db.query.stickyMessages.findFirst({
			where: eq(schema.stickyMessages.channelId, channelId),
		});

		if (!row?.enabled) return;

		// Expiry check
		if (row.expiresAt && new Date(row.expiresAt).getTime() < now) {
			// Delete sticky from DB
			await db.delete(schema.stickyMessages).where(eq(schema.stickyMessages.channelId, channelId));
			// Delete last posted message if possible
			if (row.lastMessageId) {
				const prev = await message.channel.messages.fetch(row.lastMessageId).catch(() => null);
				await prev?.delete().catch(() => null);
			}
			return;
		}

		_cooldowns.set(channelId, now);

		// Delete previous sticky post
		if (row.lastMessageId) {
			const prev = await message.channel.messages.fetch(row.lastMessageId).catch(() => null);
			await prev?.delete().catch(() => null);
		}

		// Re-post sticky
		const sent = await message.channel.send({ content: row.content }).catch(() => null);
		if (!sent) return;

		// Update the stored message ID
		await db
			.update(schema.stickyMessages)
			.set({ lastMessageId: sent.id })
			.where(eq(schema.stickyMessages.channelId, channelId));
	}
}
