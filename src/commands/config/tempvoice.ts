import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { ChannelType, PermissionFlagsBits } from 'discord.js';

@ApplyOptions<Subcommand.Options>({
	name: 'tempvoice',
	description: 'Temporary voice channels.',
	preconditions: ['Moderation'],
	subcommands: [
		{ name: 'rename', chatInputRun: 'chatInputRename' },
		{ name: 'limit', chatInputRun: 'chatInputLimit' },
		{ name: 'lock', chatInputRun: 'chatInputLock' },
		{ name: 'unlock', chatInputRun: 'chatInputUnlock' },
		{ name: 'kick', chatInputRun: 'chatInputKick' },
		{ name: 'settrigger', chatInputRun: 'chatInputSetTrigger' },
		{ name: 'setcategory', chatInputRun: 'chatInputSetCategory' },
		{ name: 'setlimit', chatInputRun: 'chatInputSetLimit' },
		{ name: 'setname', chatInputRun: 'chatInputSetName' },
		{ name: 'toggle', chatInputRun: 'chatInputToggle' },
	],
})
export class TempVoiceCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('tempvoice')
				.setDescription('Temporary voice channels.')
				.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
				.addSubcommand((sub) =>
					sub
						.setName('rename')
						.setDescription('Rename active space.')
						.addStringOption((o) =>
							o.setName('name').setDescription('New name.').setRequired(true).setMinLength(1).setMaxLength(100),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('limit')
						.setDescription('Set user limit.')
						.addIntegerOption((o) =>
							o.setName('number').setDescription('Max users.').setRequired(true).setMinValue(0).setMaxValue(99),
						),
				)
				.addSubcommand((sub) => sub.setName('lock').setDescription('Lock space.'))
				.addSubcommand((sub) => sub.setName('unlock').setDescription('Unlock space.'))
				.addSubcommand((sub) =>
					sub
						.setName('kick')
						.setDescription('Disconnect user.')
						.addUserOption((o) => o.setName('user').setDescription('User.').setRequired(true)),
				)
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

	public async chatInputRename(interaction: Subcommand.ChatInputCommandInteraction) {
		const { SpaceHandler } = await import('../../lib/config/handlers/space.js');
		return new SpaceHandler().chatInputRename(interaction);
	}
	public async chatInputLimit(interaction: Subcommand.ChatInputCommandInteraction) {
		const { SpaceHandler } = await import('../../lib/config/handlers/space.js');
		return new SpaceHandler().chatInputLimit(interaction);
	}
	public async chatInputLock(interaction: Subcommand.ChatInputCommandInteraction) {
		const { SpaceHandler } = await import('../../lib/config/handlers/space.js');
		return new SpaceHandler().chatInputLock(interaction);
	}
	public async chatInputUnlock(interaction: Subcommand.ChatInputCommandInteraction) {
		const { SpaceHandler } = await import('../../lib/config/handlers/space.js');
		return new SpaceHandler().chatInputUnlock(interaction);
	}
	public async chatInputKick(interaction: Subcommand.ChatInputCommandInteraction) {
		const { SpaceHandler } = await import('../../lib/config/handlers/space.js');
		return new SpaceHandler().chatInputKick(interaction);
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
