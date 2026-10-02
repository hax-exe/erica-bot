import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { ChannelType, PermissionFlagsBits } from 'discord.js';

/**
 * Staff temp-voice settings. Split out of `/tempvoice` so the whole command can carry a
 * ManageChannels default permission (Discord can't hide individual subcommands). Each
 * SpaceHandler config method still checks Manage Server at runtime as defence in depth —
 * server admins can override command visibility in Integrations settings.
 */
@ApplyOptions<Subcommand.Options>({
	name: 'tempvoiceadmin',
	description: 'Configure temporary voice channels (Staff only).',
	subcommands: [
		{ name: 'settrigger', chatInputRun: 'chatInputSetTrigger' },
		{ name: 'setcategory', chatInputRun: 'chatInputSetCategory' },
		{ name: 'setlimit', chatInputRun: 'chatInputSetLimit' },
		{ name: 'setname', chatInputRun: 'chatInputSetName' },
		{ name: 'toggle', chatInputRun: 'chatInputToggle' },
	],
})
export class TempVoiceAdminCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('tempvoiceadmin')
				.setDescription('Configure temporary voice channels (Staff only).')
				.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
				.addSubcommand((sub) =>
					sub
						.setName('settrigger')
						.setDescription('Set trigger channel.')
						.addChannelOption((o) =>
							o
								.setName('channel')
								.setDescription('Trigger channel.')
								.addChannelTypes(ChannelType.GuildVoice)
								.setRequired(false),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('setcategory')
						.setDescription('Set category.')
						.addChannelOption((o) =>
							o
								.setName('category')
								.setDescription('Category.')
								.addChannelTypes(ChannelType.GuildCategory)
								.setRequired(false),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('setlimit')
						.setDescription('Set default limit.')
						.addIntegerOption((o) =>
							o.setName('limit').setDescription('Max users.').setRequired(false).setMinValue(0).setMaxValue(99),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('setname')
						.setDescription('Set template.')
						.addStringOption((o) =>
							o
								.setName('template')
								.setDescription('e.g. "{displayname}\'s Space"')
								.setMaxLength(100)
								.setRequired(false),
						),
				)
				.addSubcommand((sub) => sub.setName('toggle').setDescription('Toggle system.')),
		);
	}

	public async chatInputSetTrigger(interaction: Subcommand.ChatInputCommandInteraction) {
		const { SpaceHandler } = await import('../../lib/config/handlers/space.js');
		return new SpaceHandler().chatInputConfigSetTrigger(interaction);
	}
	public async chatInputSetCategory(interaction: Subcommand.ChatInputCommandInteraction) {
		const { SpaceHandler } = await import('../../lib/config/handlers/space.js');
		return new SpaceHandler().chatInputConfigSetCategory(interaction);
	}
	public async chatInputSetLimit(interaction: Subcommand.ChatInputCommandInteraction) {
		const { SpaceHandler } = await import('../../lib/config/handlers/space.js');
		return new SpaceHandler().chatInputConfigSetLimit(interaction);
	}
	public async chatInputSetName(interaction: Subcommand.ChatInputCommandInteraction) {
		const { SpaceHandler } = await import('../../lib/config/handlers/space.js');
		return new SpaceHandler().chatInputConfigSetName(interaction);
	}
	public async chatInputToggle(interaction: Subcommand.ChatInputCommandInteraction) {
		const { SpaceHandler } = await import('../../lib/config/handlers/space.js');
		return new SpaceHandler().chatInputConfigToggle(interaction);
	}
}
