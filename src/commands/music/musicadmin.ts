import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { errorReply, successReply } from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';

/**
 * Staff music settings. Split out of `/music` so the whole command can carry a
 * ManageGuild default permission (Discord can't hide individual subcommands).
 * The runtime ManageGuild check stays as defence in depth.
 */
@ApplyOptions<Subcommand.Options>({
	name: 'musicadmin',
	description: 'Configure music settings for this server (Staff only).',
	subcommands: [
		{ name: 'maxvolume', chatInputRun: 'chatInputMaxVolume' },
		{ name: 'setup-music', chatInputRun: 'chatInputSetupMusic' },
	],
})
export class MusicAdminCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('musicadmin')
				.setDescription('Configure music settings for this server (Staff only).')
				.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
				.addSubcommand((sub) =>
					sub
						.setName('maxvolume')
						.setDescription('Set the maximum music playback volume limit for this server.')
						.addIntegerOption((o) =>
							o
								.setName('level')
								.setDescription('Maximum volume level (0–200). Default is 100.')
								.setMinValue(0)
								.setMaxValue(200)
								.setRequired(true),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('setup-music')
						.setDescription('Set up or destroy a dedicated music requests channel.')
						.addStringOption((o) =>
							o
								.setName('action')
								.setDescription('Setup action.')
								.setRequired(true)
								.addChoices({ name: 'Setup channel', value: 'setup' }, { name: 'Destroy channel', value: 'destroy' }),
						),
				),
		);
	}

	public async chatInputMaxVolume(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}
		if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
			return interaction.editReply(errorReply('You need the **Manage Server** permission to change the volume limit.'));
		}

		const level = interaction.options.getInteger('level', true);
		await db
			.insert(schema.guilds)
			.values({ id: interaction.guildId, maxVolumeLimit: level })
			.onDuplicateKeyUpdate({
				set: { maxVolumeLimit: level },
			});

		return interaction.editReply(successReply(`Maximum volume limit set to **${level}%**.`));
	}

	public async chatInputSetupMusic(interaction: Subcommand.ChatInputCommandInteraction) {
		const { SetupMusicHandler } = await import('../../lib/music/handlers/setup-music.js');
		return new SetupMusicHandler().chatInputRun(interaction);
	}
}
