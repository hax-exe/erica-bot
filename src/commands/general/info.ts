import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChannelType,
	GuildVerificationLevel,
	MessageFlags,
	PermissionFlagsBits,
	SectionBuilder,
	TextDisplayBuilder,
	ThumbnailBuilder,
	TimestampStyles,
	time,
} from 'discord.js';
import { Colors, cv2Reply, errorReply, field, makeContainer, separator, warningReply } from '../../lib/components.js';
import { getInfractions, getNotes } from '../../lib/ModerationUtil.js';

const VERIFICATION_LABELS: Record<GuildVerificationLevel, string> = {
	[GuildVerificationLevel.None]: 'None',
	[GuildVerificationLevel.Low]: 'Low',
	[GuildVerificationLevel.Medium]: 'Medium',
	[GuildVerificationLevel.High]: 'High',
	[GuildVerificationLevel.VeryHigh]: 'Highest',
};

function hasModPerms(perms: Readonly<import('discord.js').PermissionsBitField> | null): boolean {
	if (!perms) return false;
	if (perms.has(PermissionFlagsBits.Administrator)) return true;
	const modPerms =
		PermissionFlagsBits.ManageGuild |
		PermissionFlagsBits.KickMembers |
		PermissionFlagsBits.BanMembers |
		PermissionFlagsBits.ModerateMembers;
	return perms.has(modPerms);
}

const DISPLAY_PERMISSIONS = [
	[PermissionFlagsBits.Administrator, 'Administrator'],
	[PermissionFlagsBits.ManageGuild, 'Manage Server'],
	[PermissionFlagsBits.ViewAuditLog, 'View Audit Log'],
	[PermissionFlagsBits.ManageRoles, 'Manage Roles'],
	[PermissionFlagsBits.ManageChannels, 'Manage Channels'],
	[PermissionFlagsBits.ManageMessages, 'Manage Messages'],
	[PermissionFlagsBits.ManageWebhooks, 'Manage Webhooks'],
	[PermissionFlagsBits.KickMembers, 'Kick Members'],
	[PermissionFlagsBits.BanMembers, 'Ban Members'],
	[PermissionFlagsBits.ModerateMembers, 'Timeout Members'],
	[PermissionFlagsBits.MentionEveryone, 'Mention Everyone'],
] as const;

function formatKeyPermissions(perms: Readonly<import('discord.js').PermissionsBitField>): string {
	if (perms.has(PermissionFlagsBits.Administrator)) return '`Administrator`';
	const labels = DISPLAY_PERMISSIONS.filter(([flag]) => perms.has(flag)).map(([, label]) => `\`${label}\``);
	return labels.length > 0 ? labels.join(' ') : '*No elevated permissions*';
}

@ApplyOptions<Subcommand.Options>({
	name: 'info',
	description: 'Look up server and member information.',
	subcommands: [
		{ name: 'server', chatInputRun: 'chatInputServer' },
		{ name: 'user', chatInputRun: 'chatInputUser' },
		{ name: 'role', chatInputRun: 'chatInputRole' },
		{ name: 'channel', chatInputRun: 'chatInputChannel' },
		{ name: 'ping', chatInputRun: 'chatInputPing' },
		{ name: 'avatar', chatInputRun: 'chatInputAvatar' },
		{ name: 'banner', chatInputRun: 'chatInputBanner' },
		{ name: 'emoji', chatInputRun: 'chatInputEmoji' },
		{ name: 'permissions', chatInputRun: 'chatInputPermissions' },
		{ name: 'invite', chatInputRun: 'chatInputInvite' },
		{ name: 'servericon', chatInputRun: 'chatInputServerIcon' },
	],
})
export class InfoCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('info')
				.setDescription('Look up server and member information.')
				// ── server ─────────────────────────────────────────────────────────────
				.addSubcommand((sub) => sub.setName('server').setDescription('Show information about this server.'))
				// ── user ───────────────────────────────────────────────────────────────
				.addSubcommand((sub) =>
					sub
						.setName('user')
						.setDescription('Show information about a member.')
						.addUserOption((o) =>
							o.setName('user').setDescription('The user to inspect (defaults to yourself).').setRequired(false),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('role')
						.setDescription('Show information about a role.')
						.addRoleOption((o) => o.setName('role').setDescription('Role to inspect.').setRequired(true)),
				)
				.addSubcommand((sub) =>
					sub
						.setName('channel')
						.setDescription('Show information about a channel.')
						.addChannelOption((o) =>
							o.setName('channel').setDescription('Channel (defaults to current).').setRequired(false),
						),
				)
				// ── ping ───────────────────────────────────────────────────────────────
				.addSubcommand((sub) => sub.setName('ping').setDescription("Check the bot's latency."))
				// ── avatar ─────────────────────────────────────────────────────────────
				.addSubcommand((sub) =>
					sub
						.setName('avatar')
						.setDescription("Show a member's avatar in high resolution.")
						.addUserOption((o) =>
							o.setName('user').setDescription('The user to view (defaults to yourself).').setRequired(false),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('banner')
						.setDescription("Show a user's profile banner.")
						.addUserOption((o) =>
							o.setName('user').setDescription('The user to view (defaults to yourself).').setRequired(false),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('emoji')
						.setDescription('Enlarge a custom emoji and show its info.')
						.addStringOption((o) =>
							o.setName('emoji').setDescription('Custom emoji (paste or type it).').setRequired(true),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('permissions')
						.setDescription("Show a member's permissions in a channel.")
						.addUserOption((o) => o.setName('user').setDescription('Member (defaults to yourself).').setRequired(false))
						.addChannelOption((o) =>
							o.setName('channel').setDescription('Channel (defaults to current).').setRequired(false),
						),
				)
				// ── servericon ─────────────────────────────────────────────────────────
				.addSubcommand((sub) =>
					sub.setName('servericon').setDescription("Show the server's assets (icon, banner, splash)."),
				)
				.addSubcommand((sub) =>
					sub
						.setName('invite')
						.setDescription('Inspect a Discord invite link or code.')
						.addStringOption((o) => o.setName('code').setDescription('Invite URL or code.').setRequired(true)),
				),
		);
	}

	// ── /info server ───────────────────────────────────────────────────────────
	public async chatInputServer(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('Server only.'));
		}

		const guild = await interaction.guild.fetch();

		const createdTs = Math.floor(guild.createdTimestamp / 1000);
		const owner = await guild.fetchOwner().catch(() => null);

		const channels = guild.channels.cache;
		const textCount = channels.filter((c) => c.type === ChannelType.GuildText).size;
		const voiceCount = channels.filter(
			(c) => c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice,
		).size;
		const categoryCount = channels.filter((c) => c.type === ChannelType.GuildCategory).size;

		const container = makeContainer({
			color: Colors.Info,
			header: guild.name,
		});

		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(field('ID', `\`${guild.id}\``)));
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				field('Owner', owner ? `${owner.user.tag} (${owner.user.id})` : `<@${guild.ownerId}>`),
			),
		);
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				field(
					'Created',
					`${time(createdTs, TimestampStyles.LongDate)} (${time(createdTs, TimestampStyles.RelativeTime)})`,
				),
			),
		);
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(field('Verification', VERIFICATION_LABELS[guild.verificationLevel])),
		);

		container.addSeparatorComponents(separator());
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`**Members:** ${guild.memberCount.toLocaleString()}\n` +
					`**Roles:** ${guild.roles.cache.size.toLocaleString()}\n` +
					`**Emojis:** ${guild.emojis.cache.size.toLocaleString()}`,
			),
		);

		container.addSeparatorComponents(separator());
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`**Channels (${channels.size})**\n` + `${textCount} text · ${voiceCount} voice · ${categoryCount} categories`,
			),
		);

		if (guild.premiumSubscriptionCount !== null && guild.premiumSubscriptionCount > 0) {
			container.addSeparatorComponents(separator());
			container.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`**Boosts:** ${guild.premiumSubscriptionCount} (Tier ${guild.premiumTier})`,
				),
			);
		}

		return interaction.editReply(cv2Reply(container, true));
	}

	// ── /info user ─────────────────────────────────────────────────────────────
	public async chatInputUser(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}

		const target = interaction.options.getMember('user') ?? interaction.member;
		const user = target.user;

		const member = await interaction.guild.members.fetch(user.id).catch(() => null);
		if (!member) return interaction.editReply(errorReply('Could not resolve that member.'));

		const roles = member.roles.cache
			.filter((r) => r.id !== interaction.guild.id)
			.sort((a, b) => b.position - a.position);
		const roleList =
			roles.size > 0
				? [...roles.values()]
						.slice(0, 20)
						.map((r) => `<@&${r.id}>`)
						.join(' ') + (roles.size > 20 ? ` +${roles.size - 20} more` : '')
				: '*None*';

		const createdTs = Math.floor(user.createdTimestamp / 1000);
		const joinedTs = member.joinedTimestamp ? Math.floor(member.joinedTimestamp / 1000) : null;
		const keyPermissions = formatKeyPermissions(member.permissions);

		const container = makeContainer({ color: member.displayColor || Colors.Info });

		// Compact identity header
		const avatarUrl = member.displayAvatarURL({ size: 128, extension: 'png' });
		const nameLines = [`### ${member.displayName}`, `-# @${user.username} · \`${user.id}\`${user.bot ? ' · Bot' : ''}`];
		const headerSection = new SectionBuilder()
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(nameLines.join('\n')))
			.setThumbnailAccessory(new ThumbnailBuilder().setURL(avatarUrl));
		container.addSectionComponents(headerSection);

		container.addSeparatorComponents(separator());

		// Account dates
		const dateLines: string[] = [
			`**Created:** ${time(createdTs, TimestampStyles.LongDate)} · ${time(createdTs, TimestampStyles.RelativeTime)}`,
		];
		if (joinedTs) {
			dateLines.push(
				`**Joined:** ${time(joinedTs, TimestampStyles.LongDate)} · ${time(joinedTs, TimestampStyles.RelativeTime)}`,
			);
		}
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(dateLines.join('\n')));

		container.addSeparatorComponents(separator());
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				[`**Roles · ${roles.size}**`, roleList, '', '**Key Permissions**', keyPermissions].join('\n'),
			),
		);

		const isModerator = hasModPerms(interaction.memberPermissions);

		if (isModerator) {
			const infractions = await getInfractions(interaction.guild.id, user.id);
			const warnCount = infractions.filter((i) => i.type === 'warn').length;
			const otherCount = infractions.filter((i) => i.type !== 'warn').length;
			const notes = await getNotes(interaction.guild.id, user.id);
			const notesCount = notes.length;

			container.addSeparatorComponents(separator());

			container.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					[
						'**Moderation Overview**',
						`${warnCount} warning${warnCount === 1 ? '' : 's'} · ${otherCount} other infraction${otherCount === 1 ? '' : 's'} · ${notesCount} note${notesCount === 1 ? '' : 's'}`,
					].join('\n'),
				),
			);

			const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setCustomId(`mod:warn:${user.id}`).setLabel('Warn').setStyle(ButtonStyle.Secondary),
				new ButtonBuilder()
					.setCustomId(`mod:timeout:${user.id}`)
					.setLabel('Timeout')
					.setStyle(ButtonStyle.Secondary)
					.setDisabled(!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers) || !member.moderatable),
				new ButtonBuilder()
					.setCustomId(`mod:kick:${user.id}`)
					.setLabel('Kick')
					.setStyle(ButtonStyle.Secondary)
					.setDisabled(!interaction.memberPermissions?.has(PermissionFlagsBits.KickMembers) || !member.kickable),
				new ButtonBuilder()
					.setCustomId(`mod:ban:${user.id}`)
					.setLabel('Ban')
					.setStyle(ButtonStyle.Danger)
					.setDisabled(!interaction.memberPermissions?.has(PermissionFlagsBits.BanMembers) || !member.bannable),
			);

			const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setCustomId(`mod:history:${user.id}`).setLabel('History').setStyle(ButtonStyle.Primary),
				new ButtonBuilder().setCustomId(`page:notes:${user.id}:0`).setLabel('Notes').setStyle(ButtonStyle.Secondary),
				new ButtonBuilder().setCustomId(`mod:note:${user.id}`).setLabel('Add Note').setStyle(ButtonStyle.Secondary),
				new ButtonBuilder().setCustomId(`mod:copy_id:${user.id}`).setLabel('Copy ID').setStyle(ButtonStyle.Secondary),
			);

			container.addActionRowComponents(row1);
			container.addActionRowComponents(row2);
		}

		return interaction.editReply(cv2Reply(container, true));
	}

	// ── /info ping ─────────────────────────────────────────────────────────────
	public async chatInputPing(interaction: Subcommand.ChatInputCommandInteraction) {
		const start = Date.now();
		await interaction.deferReply();
		const roundtrip = Date.now() - start;
		const ws = this.container.client.ws.ping;

		const container = makeContainer({ color: Colors.Info, header: 'Pong' });
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent([`**Roundtrip** \`${roundtrip}ms\``, `**Websocket** \`${ws}ms\``].join('\n')),
		);

		return interaction.editReply(cv2Reply(container));
	}

	// ── /info avatar ───────────────────────────────────────────────────────────
	public async chatInputAvatar(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const target = interaction.options.getUser('user') ?? interaction.user;
		const member = await interaction.guild.members.fetch(target.id).catch(() => null);

		const avatarUrl = target.displayAvatarURL({ size: 1024, extension: 'png' });
		const pngUrl = target.displayAvatarURL({ size: 2048, extension: 'png' });
		const jpgUrl = target.displayAvatarURL({ size: 2048, extension: 'jpg' });
		const webpUrl = target.displayAvatarURL({ size: 2048, extension: 'webp' });
		const isAnimated = target.avatar?.startsWith('a_');
		const gifUrl = isAnimated ? target.displayAvatarURL({ size: 2048, extension: 'gif' }) : null;

		const c = makeContainer({ color: member?.displayColor || Colors.Info, header: `${target.username}'s Avatar` });
		const section = new SectionBuilder()
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`**User** <@${target.id}>\n` +
						`**Global Name:** ${target.globalName ?? '*None*'}\n` +
						`**Username:** \`${target.username}\``,
				),
			)
			.setThumbnailAccessory(new ThumbnailBuilder().setURL(avatarUrl));

		c.addSectionComponents(section);

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('PNG').setURL(pngUrl),
			new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('JPG').setURL(jpgUrl),
			new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('WEBP').setURL(webpUrl),
		);
		if (gifUrl) {
			row.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('GIF').setURL(gifUrl));
		}
		c.addActionRowComponents(row);

		return interaction.editReply(cv2Reply(c, true));
	}

	// ── /info servericon ───────────────────────────────────────────────────────
	public async chatInputServerIcon(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const guild = interaction.guild;
		const iconUrl = guild.iconURL({ size: 1024, extension: 'png' }) ?? null;
		const bannerUrl = guild.bannerURL({ size: 2048, extension: 'png' }) ?? null;
		const splashUrl = guild.splashURL({ size: 2048, extension: 'png' }) ?? null;

		if (!iconUrl && !bannerUrl && !splashUrl) {
			return interaction.editReply(errorReply('This server does not have an icon, banner, or splash image.'));
		}

		const c = makeContainer({ color: Colors.Info, header: `${guild.name} Assets` });

		const lines: string[] = [];
		const row = new ActionRowBuilder<ButtonBuilder>();

		if (iconUrl) {
			lines.push(`- **Server Icon** [Link](${iconUrl})`);
			row.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Icon').setURL(iconUrl));
		}
		if (bannerUrl) {
			lines.push(`- **Server Banner** [Link](${bannerUrl})`);
			row.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Banner').setURL(bannerUrl));
		}
		if (splashUrl) {
			lines.push(`- **Invite Splash** [Link](${splashUrl})`);
			row.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Invite Splash').setURL(splashUrl));
		}

		const text = lines.join('\n');
		const section = new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
		if (iconUrl) {
			section.setThumbnailAccessory(new ThumbnailBuilder().setURL(iconUrl));
		}
		c.addSectionComponents(section);
		c.addActionRowComponents(row);

		return interaction.editReply(cv2Reply(c, true));
	}

	// ── /info role ─────────────────────────────────────────────────────────────
	public async chatInputRole(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const role = interaction.options.getRole('role', true);
		const full =
			interaction.guild.roles.cache.get(role.id) ?? (await interaction.guild.roles.fetch(role.id).catch(() => null));
		if (!full) return interaction.editReply(errorReply('Could not resolve that role.'));

		const createdTs = Math.floor(full.createdTimestamp / 1000);
		const members = full.members.size;
		const perms = formatKeyPermissions(full.permissions);
		const c = makeContainer({ color: full.color || Colors.Info, header: full.name });
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				[
					field('ID', `\`${full.id}\``),
					field('Color', full.hexColor),
					field('Members', members.toLocaleString()),
					field('Position', String(full.position)),
					field('Hoisted', full.hoist ? 'Yes' : 'No'),
					field('Mentionable', full.mentionable ? 'Yes' : 'No'),
					field('Managed', full.managed ? 'Yes (integration)' : 'No'),
					field(
						'Created',
						`${time(createdTs, TimestampStyles.LongDate)} · ${time(createdTs, TimestampStyles.RelativeTime)}`,
					),
				].join('\n'),
			),
		);
		c.addSeparatorComponents(separator());
		c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Key Permissions**\n${perms}`));
		return interaction.editReply(cv2Reply(c, true));
	}

	// ── /info channel ──────────────────────────────────────────────────────────
	public async chatInputChannel(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const channel =
			interaction.options.getChannel('channel') ??
			interaction.channel ??
			(await interaction.guild.channels.fetch(interaction.channelId).catch(() => null));
		if (!channel) return interaction.editReply(errorReply('Could not resolve that channel.'));

		const createdTs =
			'createdTimestamp' in channel && channel.createdTimestamp ? Math.floor(channel.createdTimestamp / 1000) : null;
		const typeName = ChannelType[channel.type] ?? String(channel.type);
		const channelName = 'name' in channel && typeof channel.name === 'string' ? channel.name : null;
		const c = makeContainer({ color: Colors.Info, header: channelName ?? channel.id });
		const lines = [
			field('ID', `\`${channel.id}\``),
			field('Type', `\`${typeName}\``),
			field('Mention', `<#${channel.id}>`),
		];
		if (createdTs) {
			lines.push(
				field(
					'Created',
					`${time(createdTs, TimestampStyles.LongDate)} · ${time(createdTs, TimestampStyles.RelativeTime)}`,
				),
			);
		}
		if ('topic' in channel && channel.topic) lines.push(field('Topic', channel.topic.slice(0, 200)));
		if ('nsfw' in channel) lines.push(field('NSFW', channel.nsfw ? 'Yes' : 'No'));
		if ('bitrate' in channel && channel.bitrate) lines.push(field('Bitrate', `${channel.bitrate / 1000} kbps`));
		if ('userLimit' in channel) lines.push(field('User limit', channel.userLimit ? String(channel.userLimit) : '∞'));
		if ('rateLimitPerUser' in channel && channel.rateLimitPerUser) {
			lines.push(field('Slowmode', `${channel.rateLimitPerUser}s`));
		}
		if ('parentId' in channel && channel.parentId) lines.push(field('Category', `<#${channel.parentId}>`));
		c.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
		return interaction.editReply(cv2Reply(c, true));
	}

	// ── /info banner ───────────────────────────────────────────────────────────
	public async chatInputBanner(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const target = interaction.options.getUser('user') ?? interaction.user;
		const user = await target.fetch(true).catch(() => target);
		const banner = user.bannerURL({ size: 2048, extension: 'png' });
		if (!banner) {
			return interaction.editReply(warningReply(`${user.tag} has no profile banner.`));
		}
		const gif = user.banner?.startsWith('a_') ? user.bannerURL({ size: 2048, extension: 'gif' }) : null;
		const c = makeContainer({ color: Colors.Info, header: `${user.username}'s Banner` });
		c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**User** <@${user.id}>\n[Open banner](${banner})`));
		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('PNG').setURL(banner),
		);
		if (gif) row.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('GIF').setURL(gif));
		c.addActionRowComponents(row);
		return interaction.editReply(cv2Reply(c, true));
	}

	// ── /info emoji ────────────────────────────────────────────────────────────
	public async chatInputEmoji(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const raw = interaction.options.getString('emoji', true).trim();
		const match = raw.match(/^<(a)?:([\w]+):(\d+)>$/);
		if (!match) {
			return interaction.editReply(errorReply('Paste a **custom** emoji (unicode emoji cannot be enlarged this way).'));
		}
		const animated = Boolean(match[1]);
		const name = match[2]!;
		const id = match[3]!;
		const ext = animated ? 'gif' : 'png';
		const url = `https://cdn.discordapp.com/emojis/${id}.${ext}?size=256&quality=lossless`;
		const c = makeContainer({ color: Colors.Info, header: `:${name}:` });
		const section = new SectionBuilder()
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					[field('Name', `\`${name}\``), field('ID', `\`${id}\``), field('Animated', animated ? 'Yes' : 'No')].join(
						'\n',
					),
				),
			)
			.setThumbnailAccessory(new ThumbnailBuilder().setURL(url));
		c.addSectionComponents(section);
		c.addActionRowComponents(
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open').setURL(url),
			),
		);
		return interaction.editReply(cv2Reply(c, true));
	}

	// ── /info permissions ──────────────────────────────────────────────────────
	public async chatInputPermissions(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const user = interaction.options.getUser('user') ?? interaction.user;
		const member = await interaction.guild.members.fetch(user.id).catch(() => null);
		if (!member) return interaction.editReply(errorReply('That user is not in this server.'));

		const channel =
			interaction.options.getChannel('channel') ??
			interaction.channel ??
			(await interaction.guild.channels.fetch(interaction.channelId).catch(() => null));
		if (!channel || !('permissionsFor' in channel)) {
			return interaction.editReply(errorReply('Could not resolve a channel with permissions.'));
		}

		const perms = channel.permissionsFor(member);
		if (!perms) return interaction.editReply(errorReply('Could not resolve permissions.'));

		const allowed = DISPLAY_PERMISSIONS.filter(([flag]) => perms.has(flag)).map(([, label]) => `🟢 ${label}`);
		const denied = DISPLAY_PERMISSIONS.filter(([flag]) => !perms.has(flag)).map(([, label]) => `🔴 ${label}`);

		const c = makeContainer({ color: Colors.Info, header: 'Channel permissions' });
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`**Member** <@${member.id}>\n**Channel** <#${channel.id}>\n**Administrator** ${perms.has(PermissionFlagsBits.Administrator) ? 'Yes' : 'No'}`,
			),
		);
		c.addSeparatorComponents(separator());
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`**Key perms**\n${[...allowed, ...denied].join('\n') || '*None of the listed permissions*'}`,
			),
		);
		return interaction.editReply(cv2Reply(c, true));
	}

	// ── /info invite ───────────────────────────────────────────────────────────
	public async chatInputInvite(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const raw = interaction.options.getString('code', true).trim();
		const code = raw
			.replace(/^https?:\/\/(www\.)?discord(?:app)?\.(?:com|gg)\/(?:invite\/)?/i, '')
			.split(/[?/#]/)[0]
			?.trim();
		if (!code) return interaction.editReply(errorReply('Invalid invite code.'));

		try {
			const invite = await interaction.client.fetchInvite(code);
			const guild = invite.guild;
			const c = makeContainer({ color: Colors.Info, header: guild?.name ?? 'Invite' });
			c.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					[
						field('Code', `\`${invite.code}\``),
						field('Server', guild ? `${guild.name} (\`${guild.id}\`)` : '*Group DM / unknown*'),
						field('Channel', invite.channel ? `#${invite.channel.name} (\`${invite.channel.id}\`)` : '—'),
						field('Inviter', invite.inviter ? `${invite.inviter.tag} (\`${invite.inviter.id}\`)` : '—'),
						field(
							'Members',
							`${invite.memberCount?.toLocaleString() ?? '—'} (${invite.presenceCount?.toLocaleString() ?? '—'} online)`,
						),
						field('Temporary', invite.temporary ? 'Yes' : 'No'),
						field('Max uses', invite.maxUses ? String(invite.maxUses) : '∞'),
						field('Uses', String(invite.uses ?? '—')),
						invite.expiresAt
							? field('Expires', `${time(Math.floor(invite.expiresAt.getTime() / 1000), TimestampStyles.RelativeTime)}`)
							: field('Expires', 'Never'),
					].join('\n'),
				),
			);
			return interaction.editReply(cv2Reply(c, true));
		} catch {
			return interaction.editReply(errorReply('Invite not found or expired.'));
		}
	}
}
