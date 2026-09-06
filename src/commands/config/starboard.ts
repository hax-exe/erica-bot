import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { ChannelType, MessageFlags, PermissionFlagsBits, type TextChannel } from 'discord.js';
import { errorReply, successReply } from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';

@ApplyOptions<Command.Options>({
	name: 'starboard',
	description: 'Configure the starboard for this server.',
	preconditions: ['Moderation'],
})
export class StarboardCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('starboard')
				.setDescription('Configure the starboard for this server.')
				.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
				.addChannelOption((o) =>
					o
						.setName('channel')
						.setDescription('Starboard channel (omit to clear / disable).')
						.addChannelTypes(ChannelType.GuildText)
						.setRequired(false),
				)
				.addStringOption((o) =>
					o
						.setName('emoji')
						.setDescription('Reaction emoji that counts toward the starboard (default: ⭐).')
						.setRequired(false),
				)
				.addIntegerOption((o) =>
					o
						.setName('threshold')
						.setDescription('Number of reactions needed to be posted (default: 3).')
						.setMinValue(1)
						.setMaxValue(100)
						.setRequired(false),
				),
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}

		const channel = interaction.options.getChannel('channel') as TextChannel | null;
		const emoji = interaction.options.getString('emoji') ?? undefined;
		const threshold = interaction.options.getInteger('threshold') ?? undefined;

		const patch: Partial<typeof schema.starboardSettings.$inferInsert> = {};

		if (!channel) {
			await db
				.insert(schema.starboardSettings)
				.values({ guildId: interaction.guildId, enabled: false, channelId: null })
				.onDuplicateKeyUpdate({
					set: { enabled: false, channelId: null },
				});
			return interaction.editReply(successReply('Starboard disabled and channel cleared.'));
		}

		patch.channelId = channel.id;
		patch.enabled = true;
		if (emoji !== undefined) patch.emoji = emoji;
		if (threshold !== undefined) patch.threshold = threshold;

		await db
			.insert(schema.starboardSettings)
			.values({ guildId: interaction.guildId, ...patch })
			.onDuplicateKeyUpdate({ set: patch });

		const parts: string[] = [`Starboard channel set to <#${channel.id}>.`];
		if (emoji !== undefined) parts.push(`Emoji: ${emoji}`);
		if (threshold !== undefined) parts.push(`Threshold: **${threshold}** reactions`);

		return interaction.editReply(successReply(parts.join(' ')));
	}
}
