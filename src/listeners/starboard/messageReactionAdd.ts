import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ContainerBuilder,
	Events,
	MediaGalleryBuilder,
	MediaGalleryItemBuilder,
	type MessageReaction,
	type PartialMessageReaction,
	type PartialUser,
	SectionBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
	type TextChannel,
	TextDisplayBuilder,
	ThumbnailBuilder,
	type User,
} from 'discord.js';
import { and, eq, sql } from 'drizzle-orm';
import { CV2_FLAG } from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';

const STARBOARD_GOLD = 0xfee75c;

@ApplyOptions<Listener.Options>({
	name: 'starboardReactionAdd',
	event: Events.MessageReactionAdd,
})
export class StarboardReactionAddListener extends Listener<typeof Events.MessageReactionAdd> {
	public override async run(reaction: MessageReaction | PartialMessageReaction, _user: User | PartialUser) {
		if (reaction.partial) {
			try {
				reaction = await reaction.fetch();
			} catch {
				return;
			}
		}
		if (reaction.message.partial) {
			try {
				await reaction.message.fetch();
			} catch {
				return;
			}
		}

		const message = reaction.message;
		if (!message.guild || !message.author) return;
		if (message.author.bot) return;

		const guildId = message.guild.id;
		if (!(await isModuleEnabled(guildId, 'starboard'))) return;

		const settings = await db
			.select()
			.from(schema.starboardSettings)
			.where(eq(schema.starboardSettings.guildId, guildId))
			.limit(1)
			.then((r) => r[0] ?? null);

		if (!settings?.enabled || !settings.channelId) return;

		const reactionEmoji = reaction.emoji.id
			? `<:${reaction.emoji.name}:${reaction.emoji.id}>`
			: (reaction.emoji.name ?? '');

		if (reactionEmoji !== settings.emoji) return;

		const reactionUsers = await reaction.users.fetch();
		const count = reactionUsers.filter((u) => !u.bot && u.id !== message.author?.id).size;

		if (count < settings.threshold) return;

		const starboardChannel = message.guild.channels.cache.get(settings.channelId) as TextChannel | undefined;
		if (!starboardChannel?.isTextBased()) return;

		const args = {
			emoji: settings.emoji,
			count,
			channelId: message.channelId,
			authorUsername: message.author.username,
			authorAvatar: message.author.displayAvatarURL({ size: 64, extension: 'png' }),
			content: message.content ?? '',
			messageUrl: message.url,
			imageUrl: message.attachments.find((a) => a.contentType?.startsWith('image/'))?.url ?? null,
			createdAt: message.createdAt,
		};

		const existing = await db
			.select()
			.from(schema.starboardEntries)
			.where(and(eq(schema.starboardEntries.guildId, guildId), eq(schema.starboardEntries.sourceMessageId, message.id)))
			.limit(1)
			.then((r) => r[0] ?? null);

		if (existing) {
			const starboardMsg = await starboardChannel.messages.fetch(existing.starboardMessageId).catch(() => null);
			if (starboardMsg) {
				await starboardMsg.edit(this.buildPost(args)).catch(() => null);
			}
			return;
		}

		const starboardMsg = await starboardChannel.send(this.buildPost(args)).catch(() => null);
		if (!starboardMsg) return;

		// Use onDuplicateKeyUpdate noop to handle the race where two reactions fire simultaneously.
		// If the insert conflicts (another request beat us), delete the duplicate message.
		const insertResult = await db
			.insert(schema.starboardEntries)
			.values({
				guildId,
				sourceMessageId: message.id,
				starboardMessageId: starboardMsg.id,
				authorId: message.author.id,
				channelId: message.channelId,
			})
			.onDuplicateKeyUpdate({ set: { id: sql`${schema.starboardEntries.id}` } });
		// MySQL: affectedRows === 1 means a new row was inserted; 0/2 means duplicate.
		if (Number((insertResult as any)[0]?.affectedRows ?? 0) !== 1) {
			await starboardMsg.delete().catch(() => null);
		}
	}

	private buildPost(args: {
		emoji: string;
		count: number;
		channelId: string;
		authorUsername: string;
		authorAvatar: string;
		content: string;
		messageUrl: string;
		imageUrl: string | null;
		createdAt: Date;
	}) {
		const { emoji, count, channelId, authorUsername, authorAvatar, content, messageUrl, imageUrl, createdAt } = args;

		const container = new ContainerBuilder().setAccentColor(STARBOARD_GOLD);

		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${emoji} **${count}** <#${channelId}>`));
		container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

		const bodyLines: string[] = [`**${authorUsername}**`];
		if (content) bodyLines.push(content);
		const section = new SectionBuilder()
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(bodyLines.join('\n')))
			.setThumbnailAccessory(new ThumbnailBuilder().setURL(authorAvatar));
		container.addSectionComponents(section);

		if (imageUrl) {
			container.addMediaGalleryComponents(
				new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(imageUrl)),
			);
		}

		container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(`-# <t:${Math.floor(createdAt.getTime() / 1000)}:f>`),
		);
		container.addActionRowComponents(
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setLabel('Jump to Message').setStyle(ButtonStyle.Link).setURL(messageUrl),
			),
		);

		// biome-ignore lint/suspicious/noExplicitAny: Discord.js CV2 flag type gap
		return { components: [container], flags: CV2_FLAG } as any;
	}
}
