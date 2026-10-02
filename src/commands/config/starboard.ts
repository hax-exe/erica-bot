import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { ChannelType, MessageFlags, PermissionFlagsBits, type TextChannel } from 'discord.js';
import { eq } from 'drizzle-orm';
import { errorReply, successReply } from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';

@ApplyOptions<Command.Options>({
	name: 'starboard',
	description: 'Configure the starboard for this server.',
	requiredUserPermissions: [PermissionFlagsBits.ManageGuild],
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
						.setDescription('Starboard channel (run with no options to disable).')
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

		// No options at all → disable and clear the channel.
		if (!channel && emoji === undefined && threshold === undefined) {
			await db
				.insert(schema.starboardSettings)
				.values({ guildId: interaction.guildId, enabled: false, channelId: null })
				.onDuplicateKeyUpdate({
					set: { enabled: false, channelId: null },
				});
			return interaction.editReply(successReply('Starboard disabled and channel cleared.'));
		}

		// Only change the fields that were provided — e.g. `threshold:5` alone keeps the current channel.
		const patch: Partial<typeof schema.starboardSettings.$inferInsert> = {};
		if (channel) {
			patch.channelId = channel.id;
			patch.enabled = true;
		}
		if (emoji !== undefined) patch.emoji = emoji;
		if (threshold !== undefined) patch.threshold = threshold;

		await db
			.insert(schema.starboardSettings)
			.values({ guildId: interaction.guildId, ...patch })
			.onDuplicateKeyUpdate({ set: patch });

		const parts: string[] = [channel ? `Starboard channel set to <#${channel.id}>.` : 'Starboard settings updated.'];
		if (emoji !== undefined) parts.push(`Emoji: ${emoji}`);
		if (threshold !== undefined) parts.push(`Threshold: **${threshold}** reactions`);

		let note = '';
		if (!channel) {
			const [current] = await db
				.select({ enabled: schema.starboardSettings.enabled, channelId: schema.starboardSettings.channelId })
				.from(schema.starboardSettings)
				.where(eq(schema.starboardSettings.guildId, interaction.guildId))
				.limit(1);
			if (!current?.enabled || !current.channelId) {
				note = '\n-# No starboard channel is set yet — run `/starboard` with a `channel` to turn it on.';
			}
		}

		return interaction.editReply(successReply(`${parts.join(' ')}${note}`));
	}
}
