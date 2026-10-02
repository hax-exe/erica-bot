import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';

// No command-level permission gate: rename / limit / lock / unlock / kick act only on the caller's own
// space (SpaceHandler.getOwnedSpace). Staff settings live in /tempvoiceadmin.
@ApplyOptions<Subcommand.Options>({
	name: 'tempvoice',
	description: 'Temporary voice channels.',
	subcommands: [
		{ name: 'rename', chatInputRun: 'chatInputRename' },
		{ name: 'limit', chatInputRun: 'chatInputLimit' },
		{ name: 'lock', chatInputRun: 'chatInputLock' },
		{ name: 'unlock', chatInputRun: 'chatInputUnlock' },
		{ name: 'kick', chatInputRun: 'chatInputKick' },
	],
})
export class TempVoiceCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('tempvoice')
				.setDescription('Temporary voice channels.')
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
				),
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
}
