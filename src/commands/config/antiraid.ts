import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { PermissionFlagsBits } from 'discord.js';

@ApplyOptions<Subcommand.Options>({
	name: 'antiraid',
	description: 'Configure anti-raid protection.',
	preconditions: ['Moderation'],
	subcommands: [
		{ name: 'setup', chatInputRun: 'chatInputSetup' },
		{ name: 'toggle', chatInputRun: 'chatInputToggle' },
		{ name: 'view', chatInputRun: 'chatInputView' },
		{ name: 'lock', chatInputRun: 'chatInputLock' },
		{ name: 'unlock', chatInputRun: 'chatInputUnlock' },
	],
})
export class AntiRaidCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('antiraid')
				.setDescription('Configure anti-raid protection.')
				.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
				.addSubcommand((sub) =>
					sub
						.setName('setup')
						.setDescription('Configure anti-raid settings.')
						.addIntegerOption((o) =>
							o
								.setName('threshold')
								.setDescription('Joins to trigger raid mode.')
								.setRequired(false)
								.setMinValue(3)
								.setMaxValue(100),
						)
						.addIntegerOption((o) =>
							o
								.setName('window')
								.setDescription('Time window in seconds.')
								.setRequired(false)
								.setMinValue(5)
								.setMaxValue(60),
						)
						.addStringOption((o) =>
							o
								.setName('action')
								.setDescription('Action on raid detection.')
								.setRequired(false)
								.addChoices(
									{ name: 'Lock Server', value: 'lock' },
									{ name: 'Kick Joins', value: 'kick' },
									{ name: 'Ban Joins', value: 'ban' },
								),
						)
						.addIntegerOption((o) =>
							o
								.setName('auto_unlock')
								.setDescription('Minutes until auto-unlock.')
								.setRequired(false)
								.setMinValue(0)
								.setMaxValue(60),
						)
						.addChannelOption((o) => o.setName('log_channel').setDescription('Raid alert channel.').setRequired(false))
						.addRoleOption((o) => o.setName('alert_role').setDescription('Role to ping on raid.').setRequired(false)),
				)
				.addSubcommand((sub) => sub.setName('toggle').setDescription('Toggle protection.'))
				.addSubcommand((sub) => sub.setName('view').setDescription('View config.'))
				.addSubcommand((sub) => sub.setName('lock').setDescription('Lock server.'))
				.addSubcommand((sub) => sub.setName('unlock').setDescription('Unlock server.')),
		);
	}

	public async chatInputSetup(interaction: Subcommand.ChatInputCommandInteraction) {
		const { AntiRaidHandler } = await import('../../lib/config/handlers/antiraid.js');
		return new AntiRaidHandler().runSetup(interaction);
	}

	public async chatInputToggle(interaction: Subcommand.ChatInputCommandInteraction) {
		const { AntiRaidHandler } = await import('../../lib/config/handlers/antiraid.js');
		return new AntiRaidHandler().runToggle(interaction);
	}

	public async chatInputView(interaction: Subcommand.ChatInputCommandInteraction) {
		const { AntiRaidHandler } = await import('../../lib/config/handlers/antiraid.js');
		return new AntiRaidHandler().runView(interaction);
	}

	public async chatInputLock(interaction: Subcommand.ChatInputCommandInteraction) {
		const { AntiRaidHandler } = await import('../../lib/config/handlers/antiraid.js');
		return new AntiRaidHandler().runLock(interaction);
	}

	public async chatInputUnlock(interaction: Subcommand.ChatInputCommandInteraction) {
		const { AntiRaidHandler } = await import('../../lib/config/handlers/antiraid.js');
		return new AntiRaidHandler().runUnlock(interaction);
	}
}
