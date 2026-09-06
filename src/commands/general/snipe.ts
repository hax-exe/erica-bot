import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { SectionBuilder, TextDisplayBuilder, ThumbnailBuilder, TimestampStyles, time } from 'discord.js';
import { Colors, cv2Reply, errorReply, makeContainer, separator, warningReply } from '../../lib/components.js';
import { getDeletedSnipe, getEditedSnipe, type SnipeEntry } from '../../lib/SnipeStore.js';

function renderSnipe(entry: SnipeEntry, kind: 'deleted' | 'edited') {
	const container = makeContainer({
		color: kind === 'deleted' ? Colors.Error : Colors.Warning,
		header: kind === 'deleted' ? 'Sniped message' : 'Sniped edit',
	});

	const header = new SectionBuilder()
		.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`### ${entry.authorTag}\n-# <@${entry.authorId}> · sent ${time(Math.floor(entry.createdAt / 1000), TimestampStyles.RelativeTime)}`,
			),
		)
		.setThumbnailAccessory(
			new ThumbnailBuilder().setURL(entry.avatarUrl || 'https://cdn.discordapp.com/embed/avatars/0.png'),
		);
	container.addSectionComponents(header);
	container.addSeparatorComponents(separator());

	if (kind === 'edited' && entry.beforeContent != null) {
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(`**Before**\n${entry.beforeContent || '*empty*'}`),
		);
		container.addSeparatorComponents(separator());
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**After**\n${entry.content || '*empty*'}`));
	} else {
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(entry.content || '*No text content*'));
	}

	if (entry.attachments.length) {
		container.addSeparatorComponents(separator());
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`**Attachments**\n${entry.attachments.map((u, i) => `[file ${i + 1}](${u})`).join(' · ')}`,
			),
		);
	}

	return cv2Reply(container, false);
}

@ApplyOptions<Subcommand.Options>({
	name: 'snipe',
	description: 'Show recently deleted or edited messages in this channel.',
	subcommands: [
		{ name: 'deleted', chatInputRun: 'chatInputDeleted', default: true },
		{ name: 'edited', chatInputRun: 'chatInputEdited' },
	],
})
export class SnipeCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('snipe')
				.setDescription('Show recently deleted or edited messages in this channel.')
				.addSubcommand((sub) =>
					sub
						.setName('deleted')
						.setDescription('Show a recently deleted message.')
						.addIntegerOption((o) =>
							o
								.setName('index')
								.setDescription('Which snipe (0 = newest).')
								.setMinValue(0)
								.setMaxValue(9)
								.setRequired(false),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('edited')
						.setDescription('Show a recently edited message.')
						.addIntegerOption((o) =>
							o
								.setName('index')
								.setDescription('Which snipe (0 = newest).')
								.setMinValue(0)
								.setMaxValue(9)
								.setRequired(false),
						),
				),
		);
	}

	public async chatInputDeleted(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('Server only.', false));
		}
		const index = interaction.options.getInteger('index') ?? 0;
		const entry = getDeletedSnipe(interaction.channelId, index);
		if (!entry) {
			return interaction.editReply(warningReply('Nothing to snipe — no recent deleted messages here.', false));
		}
		return interaction.editReply(renderSnipe(entry, 'deleted'));
	}

	public async chatInputEdited(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('Server only.', false));
		}
		const index = interaction.options.getInteger('index') ?? 0;
		const entry = getEditedSnipe(interaction.channelId, index);
		if (!entry) {
			return interaction.editReply(warningReply('Nothing to snipe — no recent edits here.', false));
		}
		return interaction.editReply(renderSnipe(entry, 'edited'));
	}
}
