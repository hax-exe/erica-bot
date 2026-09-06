import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { ChannelType, PermissionFlagsBits } from 'discord.js';

@ApplyOptions<Subcommand.Options>({
	name: 'counting',
	description: 'Configure the counting channel.',
	preconditions: ['Moderation'],
	subcommands: [
		{ name: 'setup', chatInputRun: 'chatInputSetup' },
		{ name: 'disable', chatInputRun: 'chatInputDisable' },
		{ name: 'reset', chatInputRun: 'chatInputReset' },
		{ name: 'status', chatInputRun: 'chatInputStatus' },
	],
})
export class CountingCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('counting')
				.setDescription('Configure the counting channel.')
				.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
				.addSubcommand((sub) =>
					sub
						.setName('setup')
						.setDescription('Setup channel.')
						.addChannelOption((o) =>
							o
								.setName('channel')
								.setDescription('Counting channel.')
								.addChannelTypes(ChannelType.GuildText)
								.setRequired(true),
						)
						.addBooleanOption((o) =>
							o.setName('reset_on_fail').setDescription('Reset count on fail.').setRequired(false),
						),
				)
				.addSubcommand((sub) => sub.setName('disable').setDescription('Disable counting.'))
				.addSubcommand((sub) => sub.setName('reset').setDescription('Reset count.'))
				.addSubcommand((sub) => sub.setName('status').setDescription('Show status.')),
		);
	}

	public async chatInputSetup(interaction: Subcommand.ChatInputCommandInteraction) {
		const { CountingHandler } = await import('../../lib/config/handlers/counting.js');
		return new CountingHandler().chatInputSetup(interaction);
	}
	public async chatInputDisable(interaction: Subcommand.ChatInputCommandInteraction) {
		const { CountingHandler } = await import('../../lib/config/handlers/counting.js');
		return new CountingHandler().chatInputDisable(interaction);
	}
	public async chatInputReset(interaction: Subcommand.ChatInputCommandInteraction) {
		const { CountingHandler } = await import('../../lib/config/handlers/counting.js');
		return new CountingHandler().chatInputReset(interaction);
	}
	public async chatInputStatus(interaction: Subcommand.ChatInputCommandInteraction) {
		const { CountingHandler } = await import('../../lib/config/handlers/counting.js');
		return new CountingHandler().chatInputStatus(interaction);
	}
}
