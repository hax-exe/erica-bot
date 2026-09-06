import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import {
	ActionRowBuilder,
	ChannelType,
	MessageFlags,
	PermissionFlagsBits,
	StringSelectMenuBuilder,
	StringSelectMenuOptionBuilder,
	TextDisplayBuilder,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { Colors, CV2_FLAG, errorReply, makeContainer, successReply, warningReply } from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';
import { parseDuration } from '../../lib/parseDuration.js';

@ApplyOptions<Subcommand.Options>({
	name: 'sticky',
	description: 'Manage sticky messages for a channel.',
	preconditions: ['Moderation'],
	subcommands: [
		{ name: 'set', chatInputRun: 'chatInputSet' },
		{ name: 'clear', chatInputRun: 'chatInputClear' },
		{ name: 'list', chatInputRun: 'chatInputList' },
	],
})
export class StickyCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('sticky')
				.setDescription('Manage sticky messages for a channel.')
				.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
				.addSubcommand((sub) =>
					sub
						.setName('set')
						.setDescription('Set a sticky message for a channel.')
						.addStringOption((o) => o.setName('message').setDescription('The message to stick.').setRequired(true))
						.addChannelOption((o) =>
							o
								.setName('channel')
								.setDescription('Channel to sticky in (defaults to current).')
								.addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
								.setRequired(false),
						)
						.addStringOption((o) =>
							o
								.setName('duration')
								.setDescription('Automatically clear after this time (e.g. 10m, 1h).')
								.setRequired(false),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('clear')
						.setDescription('Remove the sticky message from a channel.')
						.addChannelOption((o) =>
							o
								.setName('channel')
								.setDescription('Channel to clear (defaults to current).')
								.addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
								.setRequired(false),
						),
				)
				.addSubcommand((sub) => sub.setName('list').setDescription('List all sticky messages in this server.')),
		);
	}

	public async chatInputSet(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const content = interaction.options.getString('message', true);
		const durationStr = interaction.options.getString('duration');
		const channel =
			(interaction.options.getChannel('channel') as import('discord.js').TextChannel | null) ??
			(interaction.channel as import('discord.js').TextChannel);

		if (!channel?.isTextBased()) {
			return interaction.editReply(errorReply('Invalid channel.'));
		}

		let expiresAt: Date | null = null;
		if (durationStr) {
			const ms = parseDuration(durationStr);
			if (!ms) {
				return interaction.editReply(errorReply('Invalid duration format. Use formats like `10m`, `2h`, `1d`.'));
			}
			expiresAt = new Date(Date.now() + ms);
		}

		const sent = await channel.send({ content }).catch(() => null);
		if (!sent) {
			return interaction.editReply(errorReply(`I don't have permission to send messages in <#${channel.id}>.`));
		}

		await db
			.insert(schema.stickyMessages)
			.values({
				channelId: channel.id,
				guildId: interaction.guildId,
				content,
				lastMessageId: sent.id,
				enabled: true,
				expiresAt,
			})
			.onDuplicateKeyUpdate({
				set: { content, lastMessageId: sent.id, enabled: true, expiresAt },
			});

		let expiryText = '';
		if (expiresAt) {
			expiryText = `\n⏱️ Automatically clears <t:${Math.floor(expiresAt.getTime() / 1000)}:R>.`;
		}

		return interaction.editReply(successReply(`Sticky message set in <#${channel.id}>.${expiryText}`));
	}

	public async chatInputClear(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const channel =
			(interaction.options.getChannel('channel') as import('discord.js').TextChannel | null) ??
			(interaction.channel as import('discord.js').TextChannel);

		if (!channel?.isTextBased()) {
			return interaction.editReply(errorReply('Invalid channel.'));
		}

		const row = await db.query.stickyMessages.findFirst({
			where: eq(schema.stickyMessages.channelId, channel.id),
		});

		if (!row) {
			return interaction.editReply(warningReply(`No sticky message found in <#${channel.id}>.`));
		}

		if (row.lastMessageId) {
			const msg = await channel.messages.fetch(row.lastMessageId).catch(() => null);
			await msg?.delete().catch(() => null);
		}

		await db.delete(schema.stickyMessages).where(eq(schema.stickyMessages.channelId, channel.id));

		return interaction.editReply(successReply(`Sticky message cleared from <#${channel.id}>.`));
	}

	public async chatInputList(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const rows = await db
			.select()
			.from(schema.stickyMessages)
			.where(eq(schema.stickyMessages.guildId, interaction.guildId));

		if (rows.length === 0) {
			return interaction.editReply(warningReply('No sticky messages set in this server.'));
		}

		const lines = rows.map((r) => {
			const expireStr = r.expiresAt ? ` (expires <t:${Math.floor(new Date(r.expiresAt).getTime() / 1000)}:R>)` : '';
			return `<#${r.channelId}> — ${r.content.slice(0, 45)}${r.content.length > 45 ? '…' : ''}${expireStr}`;
		});

		const container = makeContainer({ color: Colors.Info });
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(`**Sticky Messages (${rows.length})**\n${lines.join('\n')}`),
		);

		const selectMenu = new StringSelectMenuBuilder()
			.setCustomId('mod:sticky_clear_select')
			.setPlaceholder('Select a channel to clear its sticky...');

		selectMenu.addOptions(
			rows.map((r) => {
				const ch = interaction.guild.channels.cache.get(r.channelId);
				return new StringSelectMenuOptionBuilder()
					.setLabel(ch ? `#${ch.name}` : `Channel ${r.channelId}`)
					.setDescription(r.content.slice(0, 50))
					.setValue(r.channelId)
					.setEmoji('🗑️');
			}),
		);

		const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
		container.addActionRowComponents(row);

		return interaction.editReply({ components: [container], flags: CV2_FLAG });
	}
}
