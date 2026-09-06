import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { ChannelType, PermissionFlagsBits } from 'discord.js';

@ApplyOptions<Subcommand.Options>({
	name: 'welcomer',
	description: 'Configure welcomer, leave, and server boost announcements.',
	preconditions: ['Moderation'],
	subcommands: [
		{
			name: 'boost',
			type: 'group',
			entries: [
				{ name: 'setup', chatInputRun: 'chatInputBoostSetup' },
				{ name: 'message', chatInputRun: 'chatInputBoostMessage' },
				{ name: 'milestones', chatInputRun: 'chatInputBoostMilestones' },
				{ name: 'view', chatInputRun: 'chatInputBoostView' },
				{ name: 'disable', chatInputRun: 'chatInputBoostDisable' },
			],
		},
		{ name: 'welcome-channel', chatInputRun: 'chatInputWelcomerWelcomeChannel' },
		{ name: 'welcome-message', chatInputRun: 'chatInputWelcomerWelcomeMessage' },
		{ name: 'welcome-title', chatInputRun: 'chatInputWelcomerWelcomeTitle' },
		{ name: 'welcome-color', chatInputRun: 'chatInputWelcomerWelcomeColor' },
		{ name: 'welcome-footer', chatInputRun: 'chatInputWelcomerWelcomeFooter' },
		{ name: 'welcome-avatar', chatInputRun: 'chatInputWelcomerWelcomeAvatar' },
		{ name: 'welcome-autorole', chatInputRun: 'chatInputWelcomerWelcomeAutorole' },
		{ name: 'welcome-toggle', chatInputRun: 'chatInputWelcomerWelcomeToggle' },
		{ name: 'welcome-preview', chatInputRun: 'chatInputWelcomerWelcomePreview' },
		{ name: 'leave-channel', chatInputRun: 'chatInputWelcomerLeaveChannel' },
		{ name: 'leave-message', chatInputRun: 'chatInputWelcomerLeaveMessage' },
		{ name: 'leave-title', chatInputRun: 'chatInputWelcomerLeaveTitle' },
		{ name: 'leave-color', chatInputRun: 'chatInputWelcomerLeaveColor' },
		{ name: 'leave-footer', chatInputRun: 'chatInputWelcomerLeaveFooter' },
		{ name: 'leave-toggle', chatInputRun: 'chatInputWelcomerLeaveToggle' },
		{ name: 'leave-preview', chatInputRun: 'chatInputWelcomerLeavePreview' },
		{ name: 'dm-message', chatInputRun: 'chatInputWelcomerDmMessage' },
		{ name: 'dm-toggle', chatInputRun: 'chatInputWelcomerDmToggle' },
	],
})
export class ConfigWelcomerCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) => {
			builder
				.setName('welcomer')
				.setDescription('Configure welcomer and server boost announcements.')
				.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
				// ── boost ──────────────────────────────────────────────────────────────
				.addSubcommandGroup((group) =>
					group
						.setName('boost')
						.setDescription('Configure server boost announcements.')
						.addSubcommand((sub) =>
							sub
								.setName('setup')
								.setDescription('Set the channel for boost announcements.')
								.addChannelOption((o) =>
									o
										.setName('channel')
										.setDescription('Channel to send boost announcements in.')
										.addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
										.setRequired(true),
								),
						)
						.addSubcommand((sub) =>
							sub
								.setName('message')
								.setDescription('Set the boost announcement message.')
								.addStringOption((o) =>
									o
										.setName('text')
										.setDescription('Message text. Placeholders: {user}, {server}, {count}, {tier}.')
										.setRequired(true)
										.setMaxLength(500),
								),
						)
						.addSubcommand((sub) =>
							sub
								.setName('milestones')
								.setDescription('Set boost count milestones to celebrate (comma-separated, e.g. 5,10,25).')
								.addStringOption((o) =>
									o.setName('counts').setDescription('Comma-separated boost counts, e.g. "5,10,25".').setRequired(true),
								)
								.addChannelOption((o) =>
									o
										.setName('channel')
										.setDescription('Channel for milestone announcements (defaults to boost channel).')
										.addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
										.setRequired(false),
								),
						)
						.addSubcommand((sub) => sub.setName('view').setDescription('View current boost configuration.'))
						.addSubcommand((sub) => sub.setName('disable').setDescription('Disable boost announcements.')),
				)
				// ── welcomer subcommands ───────────────────────────────────────────────
				.addSubcommand((sub) =>
					sub
						.setName('welcome-channel')
						.setDescription('Set the channel for welcome messages.')
						.addChannelOption((o) =>
							o
								.setName('channel')
								.setDescription('Text channel to post welcome messages in.')
								.addChannelTypes(ChannelType.GuildText)
								.setRequired(false),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('welcome-message')
						.setDescription('Set the welcome message body.')
						.addStringOption((o) =>
							o.setName('text').setDescription('Message body.').setMaxLength(1000).setRequired(false),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('welcome-title')
						.setDescription('Set the welcome embed title.')
						.addStringOption((o) =>
							o.setName('text').setDescription('Title text.').setMaxLength(100).setRequired(false),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('welcome-color')
						.setDescription('Set the welcome embed color.')
						.addStringOption((o) => o.setName('hex').setDescription('6-digit hex code.').setRequired(false)),
				)
				.addSubcommand((sub) =>
					sub
						.setName('welcome-footer')
						.setDescription('Set the welcome embed footer.')
						.addStringOption((o) =>
							o.setName('text').setDescription('Footer text.').setMaxLength(100).setRequired(false),
						),
				)
				.addSubcommand((sub) => sub.setName('welcome-avatar').setDescription('Toggle welcome avatar thumbnail.'))
				.addSubcommand((sub) =>
					sub
						.setName('welcome-autorole')
						.setDescription('Set a welcome auto-role.')
						.addRoleOption((o) => o.setName('role').setDescription('Role to assign.').setRequired(false)),
				)
				.addSubcommand((sub) => sub.setName('welcome-toggle').setDescription('Toggle welcome messages.'))
				.addSubcommand((sub) => sub.setName('welcome-preview').setDescription('Preview welcome message.'))
				.addSubcommand((sub) =>
					sub
						.setName('leave-channel')
						.setDescription('Set the channel for leave messages.')
						.addChannelOption((o) =>
							o
								.setName('channel')
								.setDescription('Text channel to post leave messages in.')
								.addChannelTypes(ChannelType.GuildText)
								.setRequired(false),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('leave-message')
						.setDescription('Set the leave message body.')
						.addStringOption((o) =>
							o.setName('text').setDescription('Message body.').setMaxLength(1000).setRequired(false),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('leave-title')
						.setDescription('Set the leave embed title.')
						.addStringOption((o) =>
							o.setName('text').setDescription('Title text.').setMaxLength(100).setRequired(false),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('leave-color')
						.setDescription('Set the leave embed color.')
						.addStringOption((o) => o.setName('hex').setDescription('6-digit hex code.').setRequired(false)),
				)
				.addSubcommand((sub) =>
					sub
						.setName('leave-footer')
						.setDescription('Set the leave embed footer.')
						.addStringOption((o) =>
							o.setName('text').setDescription('Footer text.').setMaxLength(100).setRequired(false),
						),
				)
				.addSubcommand((sub) => sub.setName('leave-toggle').setDescription('Toggle leave messages.'))
				.addSubcommand((sub) => sub.setName('leave-preview').setDescription('Preview leave message.'))
				.addSubcommand((sub) =>
					sub
						.setName('dm-message')
						.setDescription('Set the welcome DM message.')
						.addStringOption((o) =>
							o.setName('text').setDescription('DM message text.').setMaxLength(1000).setRequired(false),
						),
				)
				.addSubcommand((sub) => sub.setName('dm-toggle').setDescription('Toggle welcome DM.'));
		});
	}

	// ── boost handlers ─────────────────────────────────────────────────────────────
	public async chatInputBoostSetup(interaction: Subcommand.ChatInputCommandInteraction) {
		const { BoostHandler } = await import('../../lib/config/handlers/boost.js');
		return new BoostHandler().runSetup(interaction);
	}
	public async chatInputBoostMessage(interaction: Subcommand.ChatInputCommandInteraction) {
		const { BoostHandler } = await import('../../lib/config/handlers/boost.js');
		return new BoostHandler().runMessage(interaction);
	}
	public async chatInputBoostMilestones(interaction: Subcommand.ChatInputCommandInteraction) {
		const { BoostHandler } = await import('../../lib/config/handlers/boost.js');
		return new BoostHandler().runMilestones(interaction);
	}
	public async chatInputBoostView(interaction: Subcommand.ChatInputCommandInteraction) {
		const { BoostHandler } = await import('../../lib/config/handlers/boost.js');
		return new BoostHandler().runView(interaction);
	}
	public async chatInputBoostDisable(interaction: Subcommand.ChatInputCommandInteraction) {
		const { BoostHandler } = await import('../../lib/config/handlers/boost.js');
		return new BoostHandler().runDisable(interaction);
	}

	// ── welcomer handlers ──────────────────────────────────────────────────────────
	public async chatInputWelcomerWelcomeChannel(interaction: Subcommand.ChatInputCommandInteraction) {
		const { WelcomerHandler } = await import('../../lib/config/handlers/welcomer.js');
		return new WelcomerHandler().chatInputWelcomeSetChannel(interaction);
	}
	public async chatInputWelcomerWelcomeMessage(interaction: Subcommand.ChatInputCommandInteraction) {
		const { WelcomerHandler } = await import('../../lib/config/handlers/welcomer.js');
		return new WelcomerHandler().chatInputWelcomeSetMessage(interaction);
	}
	public async chatInputWelcomerWelcomeTitle(interaction: Subcommand.ChatInputCommandInteraction) {
		const { WelcomerHandler } = await import('../../lib/config/handlers/welcomer.js');
		return new WelcomerHandler().chatInputWelcomeSetTitle(interaction);
	}
	public async chatInputWelcomerWelcomeColor(interaction: Subcommand.ChatInputCommandInteraction) {
		const { WelcomerHandler } = await import('../../lib/config/handlers/welcomer.js');
		return new WelcomerHandler().chatInputWelcomeSetColor(interaction);
	}
	public async chatInputWelcomerWelcomeFooter(interaction: Subcommand.ChatInputCommandInteraction) {
		const { WelcomerHandler } = await import('../../lib/config/handlers/welcomer.js');
		return new WelcomerHandler().chatInputWelcomeSetFooter(interaction);
	}
	public async chatInputWelcomerWelcomeAvatar(interaction: Subcommand.ChatInputCommandInteraction) {
		const { WelcomerHandler } = await import('../../lib/config/handlers/welcomer.js');
		return new WelcomerHandler().chatInputWelcomeToggleAvatar(interaction);
	}
	public async chatInputWelcomerWelcomeAutorole(interaction: Subcommand.ChatInputCommandInteraction) {
		const { WelcomerHandler } = await import('../../lib/config/handlers/welcomer.js');
		return new WelcomerHandler().chatInputWelcomeAutorole(interaction);
	}
	public async chatInputWelcomerWelcomeToggle(interaction: Subcommand.ChatInputCommandInteraction) {
		const { WelcomerHandler } = await import('../../lib/config/handlers/welcomer.js');
		return new WelcomerHandler().chatInputWelcomeToggle(interaction);
	}
	public async chatInputWelcomerWelcomePreview(interaction: Subcommand.ChatInputCommandInteraction) {
		const { WelcomerHandler } = await import('../../lib/config/handlers/welcomer.js');
		return new WelcomerHandler().chatInputWelcomePreview(interaction);
	}
	public async chatInputWelcomerLeaveChannel(interaction: Subcommand.ChatInputCommandInteraction) {
		const { WelcomerHandler } = await import('../../lib/config/handlers/welcomer.js');
		return new WelcomerHandler().chatInputLeaveSetChannel(interaction);
	}
	public async chatInputWelcomerLeaveMessage(interaction: Subcommand.ChatInputCommandInteraction) {
		const { WelcomerHandler } = await import('../../lib/config/handlers/welcomer.js');
		return new WelcomerHandler().chatInputLeaveSetMessage(interaction);
	}
	public async chatInputWelcomerLeaveTitle(interaction: Subcommand.ChatInputCommandInteraction) {
		const { WelcomerHandler } = await import('../../lib/config/handlers/welcomer.js');
		return new WelcomerHandler().chatInputLeaveSetTitle(interaction);
	}
	public async chatInputWelcomerLeaveColor(interaction: Subcommand.ChatInputCommandInteraction) {
		const { WelcomerHandler } = await import('../../lib/config/handlers/welcomer.js');
		return new WelcomerHandler().chatInputLeaveSetColor(interaction);
	}
	public async chatInputWelcomerLeaveFooter(interaction: Subcommand.ChatInputCommandInteraction) {
		const { WelcomerHandler } = await import('../../lib/config/handlers/welcomer.js');
		return new WelcomerHandler().chatInputLeaveSetFooter(interaction);
	}
	public async chatInputWelcomerLeaveToggle(interaction: Subcommand.ChatInputCommandInteraction) {
		const { WelcomerHandler } = await import('../../lib/config/handlers/welcomer.js');
		return new WelcomerHandler().chatInputLeaveToggle(interaction);
	}
	public async chatInputWelcomerLeavePreview(interaction: Subcommand.ChatInputCommandInteraction) {
		const { WelcomerHandler } = await import('../../lib/config/handlers/welcomer.js');
		return new WelcomerHandler().chatInputLeavePreview(interaction);
	}
	public async chatInputWelcomerDmMessage(interaction: Subcommand.ChatInputCommandInteraction) {
		const { WelcomerHandler } = await import('../../lib/config/handlers/welcomer.js');
		return new WelcomerHandler().chatInputDmSetMessage(interaction);
	}
	public async chatInputWelcomerDmToggle(interaction: Subcommand.ChatInputCommandInteraction) {
		const { WelcomerHandler } = await import('../../lib/config/handlers/welcomer.js');
		return new WelcomerHandler().chatInputDmToggle(interaction);
	}
}
