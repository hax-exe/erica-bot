import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { ChannelType, PermissionFlagsBits } from 'discord.js';

const platforms = [
	{ name: '🔴 YouTube', value: 'youtube' },
	{ name: '🟠 Reddit', value: 'reddit' },
	{ name: '🔵 Bluesky', value: 'bluesky' },
	{ name: '🟣 Twitch', value: 'twitch' },
	{ name: '⬛ TikTok', value: 'tiktok' },
];

@ApplyOptions<Subcommand.Options>({
	name: 'feeds',
	description: 'Manage social feeds.',
	preconditions: ['Moderation'],
	subcommands: [
		{ name: 'add', chatInputRun: 'chatInputAdd' },
		{ name: 'remove', chatInputRun: 'chatInputRemove' },
		{ name: 'list', chatInputRun: 'chatInputList' },
	],
})
export class FeedsCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('feeds')
				.setDescription('Manage social feeds.')
				.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
				.addSubcommand((sub) =>
					sub
						.setName('add')
						.setDescription('Subscribe a channel.')
						.addStringOption((o) =>
							o
								.setName('platform')
								.setDescription('Platform.')
								.setRequired(true)
								.addChoices(...platforms),
						)
						.addStringOption((o) => o.setName('handle').setDescription('Account.').setRequired(true))
						.addChannelOption((o) =>
							o
								.setName('channel')
								.setDescription('Post channel.')
								.addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
								.setRequired(false),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('remove')
						.setDescription('Unsubscribe.')
						.addIntegerOption((o) => o.setName('id').setDescription('Feed ID.').setRequired(true)),
				)
				.addSubcommand((sub) => sub.setName('list').setDescription('List feeds.')),
		);
	}

	public async chatInputAdd(interaction: Subcommand.ChatInputCommandInteraction) {
		const { FeedsHandler } = await import('../../lib/config/handlers/feeds.js');
		return new FeedsHandler().runAdd(interaction);
	}
	public async chatInputRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		const { FeedsHandler } = await import('../../lib/config/handlers/feeds.js');
		return new FeedsHandler().runRemove(interaction);
	}
	public async chatInputList(interaction: Subcommand.ChatInputCommandInteraction) {
		const { FeedsHandler } = await import('../../lib/config/handlers/feeds.js');
		return new FeedsHandler().runList(interaction);
	}
}
