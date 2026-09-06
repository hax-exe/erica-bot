import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { ChannelType, PermissionFlagsBits } from 'discord.js';

@ApplyOptions<Subcommand.Options>({
	name: 'stats',
	description: 'Configure stats voice channels.',
	preconditions: ['Moderation'],
	subcommands: [
		{ name: 'setup', chatInputRun: 'chatInputSetup' },
		{ name: 'remove', chatInputRun: 'chatInputRemove' },
		{ name: 'view', chatInputRun: 'chatInputView' },
	],
})
export class StatsCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('stats')
				.setDescription('Configure stats voice channels.')
				.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
				.addSubcommand((sub) =>
					sub
						.setName('setup')
						.setDescription('Assign stats channels.')
						.addChannelOption((o) =>
							o
								.setName('members')
								.setDescription('Total members channel.')
								.addChannelTypes(ChannelType.GuildVoice)
								.setRequired(false),
						)
						.addChannelOption((o) =>
							o
								.setName('online')
								.setDescription('Online members channel.')
								.addChannelTypes(ChannelType.GuildVoice)
								.setRequired(false),
						)
						.addChannelOption((o) =>
							o
								.setName('bots')
								.setDescription('Bot count channel.')
								.addChannelTypes(ChannelType.GuildVoice)
								.setRequired(false),
						)
						.addChannelOption((o) =>
							o
								.setName('channels')
								.setDescription('Channel count channel.')
								.addChannelTypes(ChannelType.GuildVoice)
								.setRequired(false),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('remove')
						.setDescription('Remove assignment.')
						.addStringOption((o) =>
							o
								.setName('stat')
								.setDescription('Stat type.')
								.setRequired(true)
								.addChoices(
									{ name: 'Members', value: 'members' },
									{ name: 'Online', value: 'online' },
									{ name: 'Bots', value: 'bots' },
									{ name: 'Channels', value: 'channels' },
									{ name: 'All', value: 'all' },
								),
						),
				)
				.addSubcommand((sub) => sub.setName('view').setDescription('View config.')),
		);
	}

	public async chatInputSetup(interaction: Subcommand.ChatInputCommandInteraction) {
		const { ServerStatsHandler } = await import('../../lib/config/handlers/serverstats.js');
		return new ServerStatsHandler().runSetup(interaction);
	}
	public async chatInputRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		const { ServerStatsHandler } = await import('../../lib/config/handlers/serverstats.js');
		return new ServerStatsHandler().runRemove(interaction);
	}
	public async chatInputView(interaction: Subcommand.ChatInputCommandInteraction) {
		const { ServerStatsHandler } = await import('../../lib/config/handlers/serverstats.js');
		return new ServerStatsHandler().runView(interaction);
	}
}
