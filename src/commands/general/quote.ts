import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { ApplicationCommandType, TextDisplayBuilder, TimestampStyles, time } from 'discord.js';
import { Colors, CV2_FLAG, errorReply, makeContainer, separator, warningReply } from '../../lib/components.js';

const MESSAGE_LINK_RE = /https?:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)/i;

async function buildQuoteReply(
	interaction: Command.ChatInputCommandInteraction | Command.ContextMenuCommandInteraction,
	message: import('discord.js').Message,
) {
	const author = message.member?.displayName ?? message.author.displayName;
	const content = message.content?.trim() || (message.attachments.size ? '*Attachment*' : '*No text content*');
	const c = makeContainer({ color: Colors.Message, header: 'Quote' });
	c.addTextDisplayComponents(
		new TextDisplayBuilder().setContent(
			`**${author}** · ${time(Math.floor(message.createdTimestamp / 1000), TimestampStyles.RelativeTime)}\n${content.slice(0, 1800)}`,
		),
	);
	if (message.attachments.size) {
		c.addSeparatorComponents(separator());
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				[...message.attachments.values()]
					.slice(0, 3)
					.map((a) => `[${a.name}](${a.url})`)
					.join(' · '),
			),
		);
	}
	c.addSeparatorComponents(separator());
	c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# [Jump to message](${message.url})`));

	return interaction.editReply({
		components: [c],
		flags: CV2_FLAG as any,
	});
}

@ApplyOptions<Command.Options>({
	name: 'quote',
	description: 'Quote a message by link or context menu.',
})
export class QuoteCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('quote')
				.setDescription('Quote a message by jump link.')
				.addStringOption((o) => o.setName('link').setDescription('Discord message link.').setRequired(true)),
		);
		registry.registerContextMenuCommand((builder) =>
			builder.setName('Quote Message').setType(ApplicationCommandType.Message),
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.', false));

		const link = interaction.options.getString('link', true);
		const match = link.match(MESSAGE_LINK_RE);
		if (!match) return interaction.editReply(errorReply('Invalid message link.', false));

		const [, guildId, channelId, messageId] = match;
		if (guildId !== interaction.guildId) {
			return interaction.editReply(errorReply('That message is from another server.', false));
		}

		const channel = await interaction.guild.channels.fetch(channelId!).catch(() => null);
		if (!channel?.isTextBased() || channel.isDMBased()) {
			return interaction.editReply(errorReply('Could not access that channel.', false));
		}

		const message = await channel.messages.fetch(messageId!).catch(() => null);
		if (!message) return interaction.editReply(warningReply('Message not found.', false));
		return buildQuoteReply(interaction, message);
	}

	public override async contextMenuRun(interaction: Command.ContextMenuCommandInteraction) {
		await interaction.deferReply();
		if (!interaction.isMessageContextMenuCommand()) return;
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.', false));
		return buildQuoteReply(interaction, interaction.targetMessage);
	}
}
