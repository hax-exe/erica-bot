import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Events, type Message } from 'discord.js';
import { and, eq, isNull, ne, or } from 'drizzle-orm';
import { isBotBlacklisted } from '../../lib/BlacklistUtil.js';
import { db, schema } from '../../lib/database.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';

@ApplyOptions<Listener.Options>({
	name: 'countingMessage',
	event: Events.MessageCreate,
})
export class CountingMessageListener extends Listener<typeof Events.MessageCreate> {
	public override async run(message: Message) {
		if (message.author.bot) return;
		if (!message.inGuild()) return;
		if (!(await isModuleEnabled(message.guildId, 'fun'))) return;
		if (await isBotBlacklisted(message.author.id)) return;

		const settings = await db.query.countingSettings.findFirst({
			where: and(eq(schema.countingSettings.guildId, message.guildId), eq(schema.countingSettings.enabled, true)),
		});

		if (!settings) return;
		if (settings.channelId !== message.channelId) return;

		const trimmed = message.content.trim();
		const num = parseInt(trimmed, 10);

		// Must be a valid integer with no extra content
		if (Number.isNaN(num) || String(num) !== trimmed) {
			await message.react('❌').catch(() => null);
			await message
				.reply({ content: '❌ That is not a valid number! Count must be a plain integer.' })
				.catch(() => null);
			return;
		}

		// Same user can't count twice in a row
		if (settings.lastUserId === message.author.id) {
			await message.react('❌').catch(() => null);
			await message.reply({ content: "❌ You can't count twice in a row!" }).catch(() => null);
			return;
		}

		const expected = settings.currentCount + 1;

		if (num !== expected) {
			await message.react('❌').catch(() => null);

			if (settings.resetOnFail) {
				const resetResult = await db
					.update(schema.countingSettings)
					.set({ currentCount: 0, lastUserId: null })
					.where(
						and(
							eq(schema.countingSettings.guildId, message.guildId),
							eq(schema.countingSettings.currentCount, settings.currentCount),
						),
					);
				if (Number((resetResult as any)[0]?.affectedRows ?? 0) === 0) {
					await message.reply({ content: '❌ The count changed before this message was processed.' }).catch(() => null);
					return;
				}

				await message
					.reply({
						content: `❌ Wrong number! The next number was **${expected}**. The count has been reset to **0**.`,
					})
					.catch(() => null);
			} else {
				await message
					.reply({
						content: `❌ Wrong number! The next number is **${expected}**.`,
					})
					.catch(() => null);
			}

			return;
		}

		// Correct count!
		const newHighScore = Math.max(settings.highScore, num);
		const isNewHighScore = num > settings.highScore && num > 1;

		const claimedResult = await db
			.update(schema.countingSettings)
			.set({
				currentCount: num,
				lastUserId: message.author.id,
				highScore: newHighScore,
			})
			.where(
				and(
					eq(schema.countingSettings.guildId, message.guildId),
					eq(schema.countingSettings.currentCount, settings.currentCount),
					or(isNull(schema.countingSettings.lastUserId), ne(schema.countingSettings.lastUserId, message.author.id)),
				),
			);
		const claimed = Number((claimedResult as any)[0]?.affectedRows ?? 0) > 0;
		if (!claimed) {
			await message.react('❌').catch(() => null);
			await message
				.reply({ content: '❌ Someone else counted first. Check the latest number and try again.' })
				.catch(() => null);
			return;
		}

		await message.react('✅').catch(() => null);
		if (isNewHighScore) {
			await message.react('🎉').catch(() => null);
		}
	}
}
