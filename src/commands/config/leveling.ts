import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import {
	BOOST_MAX_DURATION_MS,
	BOOST_PERCENT_MAX,
	BOOST_PERCENT_MIN,
	MULTIPLIER_PERCENT_MAX,
	MULTIPLIER_PERCENT_MIN,
} from '../../lib/LevelingUtil.js';
import { humanDuration } from '../../lib/parseDuration.js';

@ApplyOptions<Subcommand.Options>({
	name: 'leveling',
	description: 'Configure leveling systems.',
	requiredUserPermissions: [PermissionFlagsBits.ManageGuild],
	preconditions: ['Moderation'],
	subcommands: [
		{ name: 'enable', chatInputRun: 'chatInputLevelingEnable' },
		{ name: 'disable', chatInputRun: 'chatInputLevelingDisable' },
		{ name: 'xp-rate', chatInputRun: 'chatInputLevelingXpRate' },
		{ name: 'levelup-channel', chatInputRun: 'chatInputLevelingLevelupChannel' },
		{ name: 'levelup-message', chatInputRun: 'chatInputLevelingLevelupMessage' },
		{ name: 'no-xp-role-add', chatInputRun: 'chatInputLevelingNoXpRoleAdd' },
		{ name: 'no-xp-role-remove', chatInputRun: 'chatInputLevelingNoXpRoleRemove' },
		{ name: 'no-xp-channel-add', chatInputRun: 'chatInputLevelingNoXpChannelAdd' },
		{ name: 'no-xp-channel-remove', chatInputRun: 'chatInputLevelingNoXpChannelRemove' },
		{ name: 'role-reward-add', chatInputRun: 'chatInputLevelingRoleRewardAdd' },
		{ name: 'role-reward-remove', chatInputRun: 'chatInputLevelingRoleRewardRemove' },
		{ name: 'role-reward-list', chatInputRun: 'chatInputLevelingRoleRewardList' },
		{ name: 'voice-xp', chatInputRun: 'chatInputLevelingVoiceXp' },
		{ name: 'no-xp-voice-add', chatInputRun: 'chatInputLevelingNoXpVoiceAdd' },
		{ name: 'no-xp-voice-remove', chatInputRun: 'chatInputLevelingNoXpVoiceRemove' },
		{
			name: 'multiplier',
			type: 'group',
			entries: [
				{ name: 'set-role', chatInputRun: 'chatInputLevelingMultiplierSetRole' },
				{ name: 'set-channel', chatInputRun: 'chatInputLevelingMultiplierSetChannel' },
				{ name: 'remove', chatInputRun: 'chatInputLevelingMultiplierRemove' },
				{ name: 'list', chatInputRun: 'chatInputLevelingMultiplierList' },
			],
		},
		{
			name: 'boost',
			type: 'group',
			entries: [
				{ name: 'start', chatInputRun: 'chatInputLevelingBoostStart' },
				{ name: 'stop', chatInputRun: 'chatInputLevelingBoostStop' },
			],
		},
		{ name: 'view', chatInputRun: 'chatInputLevelingView' },
	],
})
export class ConfigLevelingCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) => {
			builder
				.setName('leveling')
				.setDescription('Configure leveling systems.')
				.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
				.addSubcommand((sub) => sub.setName('enable').setDescription('Enable leveling in this server.'))
				.addSubcommand((sub) => sub.setName('disable').setDescription('Disable leveling in this server.'))
				.addSubcommand((sub) =>
					sub
						.setName('xp-rate')
						.setDescription('Set XP gain range and cooldown.')
						.addIntegerOption((o) =>
							o.setName('min').setDescription('Min XP per message').setMinValue(1).setMaxValue(1000).setRequired(true),
						)
						.addIntegerOption((o) =>
							o.setName('max').setDescription('Max XP per message').setMinValue(1).setMaxValue(1000).setRequired(true),
						)
						.addIntegerOption((o) =>
							o
								.setName('cooldown')
								.setDescription('Seconds between XP gains')
								.setMinValue(0)
								.setMaxValue(3600)
								.setRequired(true),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('levelup-channel')
						.setDescription('Channel to post level-up messages (omit to use the message channel).')
						.addChannelOption((o) =>
							o.setName('channel').setDescription('Channel (leave blank to reset)').setRequired(false),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('levelup-message')
						.setDescription('Customise the level-up message. Placeholders: {mention} {user} {level}')
						.addStringOption((o) =>
							o.setName('message').setDescription('Message text').setMaxLength(500).setRequired(true),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('no-xp-role-add')
						.setDescription('Add a role that earns no XP.')
						.addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)),
				)
				.addSubcommand((sub) =>
					sub
						.setName('no-xp-role-remove')
						.setDescription('Remove a no-XP role restriction.')
						.addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)),
				)
				.addSubcommand((sub) =>
					sub
						.setName('no-xp-channel-add')
						.setDescription('Add a channel where XP is not earned.')
						.addChannelOption((o) => o.setName('channel').setDescription('Channel').setRequired(true)),
				)
				.addSubcommand((sub) =>
					sub
						.setName('no-xp-channel-remove')
						.setDescription('Remove a no-XP channel restriction.')
						.addChannelOption((o) => o.setName('channel').setDescription('Channel').setRequired(true)),
				)
				.addSubcommand((sub) =>
					sub
						.setName('role-reward-add')
						.setDescription('Assign a role when a member reaches a level.')
						.addIntegerOption((o) =>
							o.setName('level').setDescription('Level threshold').setMinValue(1).setRequired(true),
						)
						.addRoleOption((o) => o.setName('role').setDescription('Role to assign').setRequired(true)),
				)
				.addSubcommand((sub) =>
					sub
						.setName('role-reward-remove')
						.setDescription('Remove a level role reward.')
						.addIntegerOption((o) =>
							o.setName('level').setDescription('Level threshold').setMinValue(1).setRequired(true),
						)
						.addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)),
				)
				.addSubcommand((sub) => sub.setName('role-reward-list').setDescription('List all level role rewards.'))
				.addSubcommand((sub) =>
					sub
						.setName('voice-xp')
						.setDescription('Configure voice channel XP awards.')
						.addBooleanOption((o) =>
							o.setName('enabled').setDescription('Enable or disable voice XP').setRequired(true),
						)
						.addIntegerOption((o) =>
							o
								.setName('xp-per-minute')
								.setDescription('XP awarded per minute in voice (default 3)')
								.setMinValue(1)
								.setMaxValue(60)
								.setRequired(false),
						)
						.addIntegerOption((o) =>
							o
								.setName('min-members')
								.setDescription('Minimum humans in VC to earn XP (default 1)')
								.setMinValue(1)
								.setMaxValue(20)
								.setRequired(false),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('no-xp-voice-add')
						.setDescription('Add a voice channel where XP is not earned.')
						.addChannelOption((o) => o.setName('channel').setDescription('Voice channel').setRequired(true)),
				)
				.addSubcommand((sub) =>
					sub
						.setName('no-xp-voice-remove')
						.setDescription('Remove a voice channel from the no-XP list.')
						.addChannelOption((o) => o.setName('channel').setDescription('Voice channel').setRequired(true)),
				)
				.addSubcommandGroup((group) =>
					group
						.setName('multiplier')
						.setDescription('Give roles or channels an XP multiplier.')
						.addSubcommand((sub) =>
							sub
								.setName('set-role')
								.setDescription('Members with this role earn more (or less) XP.')
								.addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true))
								.addIntegerOption((o) =>
									o
										.setName('percent')
										.setDescription('XP percent: 100 = normal, 150 = 1.5x, 50 = half')
										.setMinValue(MULTIPLIER_PERCENT_MIN)
										.setMaxValue(MULTIPLIER_PERCENT_MAX)
										.setRequired(true),
								),
						)
						.addSubcommand((sub) =>
							sub
								.setName('set-channel')
								.setDescription('XP earned in this channel (and its threads) is multiplied.')
								.addChannelOption((o) =>
									o
										.setName('channel')
										.setDescription('Text, voice, stage or forum channel')
										.addChannelTypes(
											ChannelType.GuildText,
											ChannelType.GuildAnnouncement,
											ChannelType.GuildVoice,
											ChannelType.GuildStageVoice,
											ChannelType.GuildForum,
											ChannelType.GuildMedia,
										)
										.setRequired(true),
								)
								.addIntegerOption((o) =>
									o
										.setName('percent')
										.setDescription('XP percent: 100 = normal, 150 = 1.5x, 50 = half')
										.setMinValue(MULTIPLIER_PERCENT_MIN)
										.setMaxValue(MULTIPLIER_PERCENT_MAX)
										.setRequired(true),
								),
						)
						.addSubcommand((sub) =>
							sub
								.setName('remove')
								.setDescription('Remove a role and/or channel multiplier.')
								.addRoleOption((o) => o.setName('role').setDescription('Role to clear').setRequired(false))
								.addChannelOption((o) => o.setName('channel').setDescription('Channel to clear').setRequired(false)),
						)
						.addSubcommand((sub) =>
							sub.setName('list').setDescription('List all XP multipliers and the active boost.'),
						),
				)
				.addSubcommandGroup((group) =>
					group
						.setName('boost')
						.setDescription('Run a temporary server-wide XP boost.')
						.addSubcommand((sub) =>
							sub
								.setName('start')
								.setDescription('Start a timed XP boost (replaces any running boost).')
								.addIntegerOption((o) =>
									o
										.setName('percent')
										.setDescription('XP percent while boosted: 150 = 1.5x, 200 = double')
										.setMinValue(BOOST_PERCENT_MIN)
										.setMaxValue(BOOST_PERCENT_MAX)
										.setRequired(true),
								)
								.addStringOption((o) =>
									o
										.setName('duration')
										.setDescription(`How long, e.g. 2h or 1d (max ${humanDuration(BOOST_MAX_DURATION_MS)})`)
										.setMaxLength(50)
										.setRequired(true),
								),
						)
						.addSubcommand((sub) => sub.setName('stop').setDescription('Stop the running XP boost.')),
				)
				.addSubcommand((sub) => sub.setName('view').setDescription('Show the current leveling configuration.'));
		});
	}

	// ── leveling handlers ──────────────────────────────────────────────────────────
	public async chatInputLevelingEnable(interaction: Subcommand.ChatInputCommandInteraction) {
		const { LevelConfigHandler } = await import('../../lib/config/handlers/levelconfig.js');
		return new LevelConfigHandler().chatInputEnable(interaction);
	}
	public async chatInputLevelingDisable(interaction: Subcommand.ChatInputCommandInteraction) {
		const { LevelConfigHandler } = await import('../../lib/config/handlers/levelconfig.js');
		return new LevelConfigHandler().chatInputDisable(interaction);
	}
	public async chatInputLevelingXpRate(interaction: Subcommand.ChatInputCommandInteraction) {
		const { LevelConfigHandler } = await import('../../lib/config/handlers/levelconfig.js');
		return new LevelConfigHandler().chatInputXpRate(interaction);
	}
	public async chatInputLevelingLevelupChannel(interaction: Subcommand.ChatInputCommandInteraction) {
		const { LevelConfigHandler } = await import('../../lib/config/handlers/levelconfig.js');
		return new LevelConfigHandler().chatInputLevelupChannel(interaction);
	}
	public async chatInputLevelingLevelupMessage(interaction: Subcommand.ChatInputCommandInteraction) {
		const { LevelConfigHandler } = await import('../../lib/config/handlers/levelconfig.js');
		return new LevelConfigHandler().chatInputLevelupMessage(interaction);
	}
	public async chatInputLevelingNoXpRoleAdd(interaction: Subcommand.ChatInputCommandInteraction) {
		const { LevelConfigHandler } = await import('../../lib/config/handlers/levelconfig.js');
		return new LevelConfigHandler().chatInputNoXpRoleAdd(interaction);
	}
	public async chatInputLevelingNoXpRoleRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		const { LevelConfigHandler } = await import('../../lib/config/handlers/levelconfig.js');
		return new LevelConfigHandler().chatInputNoXpRoleRemove(interaction);
	}
	public async chatInputLevelingNoXpChannelAdd(interaction: Subcommand.ChatInputCommandInteraction) {
		const { LevelConfigHandler } = await import('../../lib/config/handlers/levelconfig.js');
		return new LevelConfigHandler().chatInputNoXpChannelAdd(interaction);
	}
	public async chatInputLevelingNoXpChannelRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		const { LevelConfigHandler } = await import('../../lib/config/handlers/levelconfig.js');
		return new LevelConfigHandler().chatInputNoXpChannelRemove(interaction);
	}
	public async chatInputLevelingRoleRewardAdd(interaction: Subcommand.ChatInputCommandInteraction) {
		const { LevelConfigHandler } = await import('../../lib/config/handlers/levelconfig.js');
		return new LevelConfigHandler().chatInputRoleRewardAdd(interaction);
	}
	public async chatInputLevelingRoleRewardRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		const { LevelConfigHandler } = await import('../../lib/config/handlers/levelconfig.js');
		return new LevelConfigHandler().chatInputRoleRewardRemove(interaction);
	}
	public async chatInputLevelingRoleRewardList(interaction: Subcommand.ChatInputCommandInteraction) {
		const { LevelConfigHandler } = await import('../../lib/config/handlers/levelconfig.js');
		return new LevelConfigHandler().chatInputRoleRewardList(interaction);
	}
	public async chatInputLevelingVoiceXp(interaction: Subcommand.ChatInputCommandInteraction) {
		const { LevelConfigHandler } = await import('../../lib/config/handlers/levelconfig.js');
		return new LevelConfigHandler().chatInputVoiceXp(interaction);
	}
	public async chatInputLevelingNoXpVoiceAdd(interaction: Subcommand.ChatInputCommandInteraction) {
		const { LevelConfigHandler } = await import('../../lib/config/handlers/levelconfig.js');
		return new LevelConfigHandler().chatInputNoXpVoiceAdd(interaction);
	}
	public async chatInputLevelingNoXpVoiceRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		const { LevelConfigHandler } = await import('../../lib/config/handlers/levelconfig.js');
		return new LevelConfigHandler().chatInputNoXpVoiceRemove(interaction);
	}
	public async chatInputLevelingMultiplierSetRole(interaction: Subcommand.ChatInputCommandInteraction) {
		const { LevelConfigHandler } = await import('../../lib/config/handlers/levelconfig.js');
		return new LevelConfigHandler().chatInputMultiplierSetRole(interaction);
	}
	public async chatInputLevelingMultiplierSetChannel(interaction: Subcommand.ChatInputCommandInteraction) {
		const { LevelConfigHandler } = await import('../../lib/config/handlers/levelconfig.js');
		return new LevelConfigHandler().chatInputMultiplierSetChannel(interaction);
	}
	public async chatInputLevelingMultiplierRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		const { LevelConfigHandler } = await import('../../lib/config/handlers/levelconfig.js');
		return new LevelConfigHandler().chatInputMultiplierRemove(interaction);
	}
	public async chatInputLevelingMultiplierList(interaction: Subcommand.ChatInputCommandInteraction) {
		const { LevelConfigHandler } = await import('../../lib/config/handlers/levelconfig.js');
		return new LevelConfigHandler().chatInputMultiplierList(interaction);
	}
	public async chatInputLevelingBoostStart(interaction: Subcommand.ChatInputCommandInteraction) {
		const { LevelConfigHandler } = await import('../../lib/config/handlers/levelconfig.js');
		return new LevelConfigHandler().chatInputBoostStart(interaction);
	}
	public async chatInputLevelingBoostStop(interaction: Subcommand.ChatInputCommandInteraction) {
		const { LevelConfigHandler } = await import('../../lib/config/handlers/levelconfig.js');
		return new LevelConfigHandler().chatInputBoostStop(interaction);
	}
	public async chatInputLevelingView(interaction: Subcommand.ChatInputCommandInteraction) {
		const { LevelConfigHandler } = await import('../../lib/config/handlers/levelconfig.js');
		return new LevelConfigHandler().chatInputView(interaction);
	}
}
