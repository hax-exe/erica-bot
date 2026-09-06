import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Events, type Message } from 'discord.js';
import { and, eq, inArray } from 'drizzle-orm';
import { isBotBlacklisted } from '../../lib/BlacklistUtil.js';
import { db, schema } from '../../lib/database.js';

@ApplyOptions<Listener.Options>({
	name: 'afkMessageCreate',
	event: Events.MessageCreate,
})
export class AfkMessageCreateListener extends Listener<typeof Events.MessageCreate> {
	public override async run(message: Message) {
		if (message.author.bot) return;
		if (!message.guild) return;
		if (await isBotBlacklisted(message.author.id)) return;

		const guildId = message.guild.id;
		const authorId = message.author.id;

		// Clear the author's AFK if they had one
		const authorAfk = await db.query.afkStatuses.findFirst({
			where: and(eq(schema.afkStatuses.userId, authorId), eq(schema.afkStatuses.guildId, guildId)),
		});
		if (authorAfk) {
			await db
				.delete(schema.afkStatuses)
				.where(and(eq(schema.afkStatuses.userId, authorId), eq(schema.afkStatuses.guildId, guildId)));

			message.reply({ content: `Welcome back, <@${authorId}>! I've removed your AFK status.` }).catch(() => null);
			return; // Don't also notify about mentioned AFKs in the same message
		}

		// Check if any mentioned users are AFK
		const mentionedIds = [...message.mentions.users.keys()].filter((id) => id !== authorId);
		if (!mentionedIds.length) return;

		const afkRows = await db.query.afkStatuses.findMany({
			where: and(eq(schema.afkStatuses.guildId, guildId), inArray(schema.afkStatuses.userId, mentionedIds)),
		});
		if (!afkRows.length) return;

		const lines = afkRows.map((row) => {
			const relativeTime = `<t:${Math.floor(row.setAt.getTime() / 1000)}:R>`;
			return `<@${row.userId}> is AFK: **${row.reason}** (${relativeTime})`;
		});

		message.reply({ content: lines.join('\n'), allowedMentions: { parse: [] } }).catch(() => null);
	}
}
