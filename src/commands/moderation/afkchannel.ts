import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { ChannelType, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { errorReply, successReply, warningReply } from '../../lib/components.js';

const AFK_TIMEOUTS = [60, 300, 900, 1800, 3600] as const;

@ApplyOptions<Subcommand.Options>({
	name: 'afkchannel',
	description: 'Configure the server AFK voice channel (Discord native idle move).',
	requiredUserPermissions: [PermissionFlagsBits.ManageGuild],
	preconditions: ['Moderation'],
	subcommands: [
		{ name: 'set', chatInputRun: 'chatInputSet' },
		{ name: 'clear', chatInputRun: 'chatInputClear' },
		{ name: 'view', chatInputRun: 'chatInputView' },
	],
})
export class AfkChannelCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('afkchannel')
				.setDescription('Configure the server AFK voice channel (moves idle members).')
				.addSubcommand((sub) =>
					sub
						.setName('set')
						.setDescription('Set AFK voice channel and idle timeout.')
						.addChannelOption((o) =>
							o
								.setName('channel')
								.setDescription('Voice channel to move idle members into.')
								.addChannelTypes(ChannelType.GuildVoice)
								.setRequired(true),
						)
						.addIntegerOption((o) =>
							o
								.setName('timeout')
								.setDescription('Idle minutes before move (Discord-supported values).')
								.setRequired(false)
								.addChoices(
									{ name: '1 minute', value: 60 },
									{ name: '5 minutes', value: 300 },
									{ name: '15 minutes', value: 900 },
									{ name: '30 minutes', value: 1800 },
									{ name: '1 hour', value: 3600 },
								),
						),
				)
				.addSubcommand((sub) => sub.setName('clear').setDescription('Disable the AFK voice channel.'))
				.addSubcommand((sub) => sub.setName('view').setDescription('Show current AFK channel settings.')),
		);
	}

	public async chatInputSet(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const channel = interaction.options.getChannel('channel', true);
		const timeout = interaction.options.getInteger('timeout') ?? interaction.guild.afkTimeout ?? 300;
		if (!AFK_TIMEOUTS.includes(timeout as (typeof AFK_TIMEOUTS)[number])) {
			return interaction.editReply(errorReply('Invalid timeout value.'));
		}

		await interaction.guild.setAFKChannel(channel.id);
		await interaction.guild.setAFKTimeout(timeout);
		return interaction.editReply(
			successReply(
				`AFK channel set to <#${channel.id}> — members idle for **${timeout / 60}m** (muted/deafened) are moved there.`,
			),
		);
	}

	public async chatInputClear(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));
		await interaction.guild.setAFKChannel(null);
		return interaction.editReply(successReply('AFK channel cleared.'));
	}

	public async chatInputView(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));
		const ch = interaction.guild.afkChannel;
		if (!ch) return interaction.editReply(warningReply('No AFK channel configured.'));
		return interaction.editReply(
			successReply(`AFK channel: <#${ch.id}> · timeout **${interaction.guild.afkTimeout / 60}m**.`),
		);
	}
}
