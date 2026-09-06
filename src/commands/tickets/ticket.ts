import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import {
	ChannelType,
	MessageFlags,
	PermissionFlagsBits,
	type TextChannel,
	TextDisplayBuilder,
	TimestampStyles,
	time,
	userMention,
	WebhookClient,
} from 'discord.js';
import { and, eq } from 'drizzle-orm';
import {
	Colors,
	CV2_FLAG,
	cv2Reply,
	errorReply,
	makeContainer,
	separator,
	successReply,
	warningReply,
} from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';
import { getReviewSettings, upsertReviewSettings } from '../../lib/ReviewUtil.js';
import { closeTicket, friendlyTicketError, postTicketPanel } from '../../lib/TicketManager.js';
import { updateTicketStatsChannels } from '../../lib/TicketStatsChannelUtil.js';
import {
	formatDuration,
	getGuildTicketStats,
	getStaffMemberTicketStats,
	getStaffTicketStats,
	type TicketStatsTimeframe,
	timeframeLabel,
} from '../../lib/TicketStatsUtil.js';
import {
	getGuildCategoriesFromConfig,
	getTicketSettingsFromConfig,
	reloadTicketsConfig,
} from '../../lib/TicketsConfig.js';

async function tryDeleteWebhook(url: string): Promise<void> {
	const match = url.match(/webhooks\/(\d+)\/([^/?]+)/);
	if (!match) return;
	const [, id, token] = match;
	const wh = new WebhookClient({ id, token });
	try {
		await wh.delete('Log channel changed via /ticket');
	} catch {
		// Already deleted or missing — ignore
	} finally {
		wh.destroy();
	}
}

@ApplyOptions<Subcommand.Options>({
	name: 'ticket',
	description: 'Manage the ticket system.',
	preconditions: ['TicketStaff'],
	subcommands: [
		{ name: 'panel', chatInputRun: 'chatInputPanel' },
		{ name: 'reload', chatInputRun: 'chatInputReload' },
		{ name: 'close', chatInputRun: 'chatInputClose' },
		{ name: 'add', chatInputRun: 'chatInputAdd' },
		{ name: 'remove', chatInputRun: 'chatInputRemove' },
		{ name: 'setticketlogchannel', chatInputRun: 'chatInputSetTicketLogChannel' },
		{ name: 'stats', chatInputRun: 'chatInputStats' },
		{
			name: 'reviews',
			type: 'group',
			entries: [
				{ name: 'channel', chatInputRun: 'chatInputSetReviewsChannel' },
				{ name: 'toggle', chatInputRun: 'chatInputToggleReviews' },
			],
		},
		{
			name: 'blacklist',
			type: 'group',
			entries: [
				{ name: 'add', chatInputRun: 'chatInputBlacklistAdd' },
				{ name: 'remove', chatInputRun: 'chatInputBlacklistRemove' },
				{ name: 'list', chatInputRun: 'chatInputBlacklistList' },
			],
		},
	],
})
export class TicketCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('ticket')
				.setDescription('Manage the ticket system.')
				// ── panel ──────────────────────────────────────────────────────
				.addSubcommand((sub) =>
					sub.setName('panel').setDescription('Post the ticket selection panel from config/tickets.yml.'),
				)
				// ── reload ─────────────────────────────────────────────────────
				.addSubcommand((sub) => sub.setName('reload').setDescription('Reload ticket config from config/tickets.yml.'))
				// ── close ──────────────────────────────────────────────────────
				.addSubcommand((sub) =>
					sub
						.setName('close')
						.setDescription('Force-close an open ticket channel.')
						.addChannelOption((o) =>
							o
								.setName('channel')
								.setDescription('The ticket channel to close (defaults to current).')
								.addChannelTypes(ChannelType.GuildText)
								.setRequired(false),
						)
						.addStringOption((o) => o.setName('reason').setDescription('Reason for closing.').setRequired(false)),
				)
				// ── add ────────────────────────────────────────────────────────
				.addSubcommand((sub) =>
					sub
						.setName('add')
						.setDescription('Add a user to a ticket channel.')
						.addUserOption((o) => o.setName('user').setDescription('User to add.').setRequired(true))
						.addChannelOption((o) =>
							o
								.setName('channel')
								.setDescription('The ticket channel (defaults to current).')
								.addChannelTypes(ChannelType.GuildText)
								.setRequired(false),
						),
				)
				// ── remove ─────────────────────────────────────────────────────
				.addSubcommand((sub) =>
					sub
						.setName('remove')
						.setDescription('Remove a user from a ticket channel.')
						.addUserOption((o) => o.setName('user').setDescription('User to remove.').setRequired(true))
						.addChannelOption((o) =>
							o
								.setName('channel')
								.setDescription('The ticket channel (defaults to current).')
								.addChannelTypes(ChannelType.GuildText)
								.setRequired(false),
						),
				)
				// ── setticketlogchannel ────────────────────────────────────────────────
				.addSubcommand((sub) =>
					sub
						.setName('setticketlogchannel')
						.setDescription('Set or clear the channel for ticket activity logs.')
						.addChannelOption((o) =>
							o
								.setName('channel')
								.setDescription('Text channel to post ticket logs in (omit to clear).')
								.addChannelTypes(ChannelType.GuildText)
								.setRequired(false),
						),
				)
				// ── stats ────────────────────────────────────────────────────────
				.addSubcommand((sub) =>
					sub
						.setName('stats')
						.setDescription('Support statistics — reviews, average close time, and staff breakdown.')
						.addStringOption((o) =>
							o
								.setName('timeframe')
								.setDescription('Time window for closed tickets and reviews.')
								.setRequired(false)
								.addChoices(
									{ name: 'Past 7 days', value: '7d' },
									{ name: 'Past 30 days', value: '30d' },
									{ name: 'All time', value: 'all' },
								),
						)
						.addUserOption((o) =>
							o.setName('staff').setDescription('Show stats for a specific staff member.').setRequired(false),
						),
				)
				// ── reviews group ────────────────────────────────────────────────
				.addSubcommandGroup((group) =>
					group
						.setName('reviews')
						.setDescription('Configure post-close ticket reviews.')
						.addSubcommand((sub) =>
							sub
								.setName('channel')
								.setDescription('Set or clear the channel where ticket reviews are posted.')
								.addChannelOption((o) =>
									o
										.setName('channel')
										.setDescription('Text channel to post reviews in (omit to clear).')
										.addChannelTypes(ChannelType.GuildText)
										.setRequired(false),
								),
						)
						.addSubcommand((sub) =>
							sub.setName('toggle').setDescription('Enable or disable review requests when tickets close.'),
						),
				)
				// ── blacklist group ──────────────────────────────────────────────
				.addSubcommandGroup((group) =>
					group
						.setName('blacklist')
						.setDescription('Block users from opening support tickets.')
						.addSubcommand((sub) =>
							sub
								.setName('add')
								.setDescription('Block a user from opening support tickets.')
								.addUserOption((o) =>
									o.setName('user').setDescription('The user to blacklist from support.').setRequired(true),
								)
								.addStringOption((o) =>
									o.setName('reason').setDescription('Reason for the blacklist.').setRequired(false),
								),
						)
						.addSubcommand((sub) =>
							sub
								.setName('remove')
								.setDescription('Allow a previously blocked user to open tickets again.')
								.addUserOption((o) =>
									o.setName('user').setDescription('The user to remove from the blacklist.').setRequired(true),
								),
						)
						.addSubcommand((sub) =>
							sub.setName('list').setDescription('List all users blocked from support in this server.'),
						),
				),
		);
	}

	private checkAdmin(interaction: Subcommand.ChatInputCommandInteraction): boolean {
		if (
			!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) &&
			!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
		) {
			interaction.editReply(
				errorReply('You must have the **Manage Channels** permission to configure the ticket system.'),
			);
			return false;
		}
		return true;
	}

	// ── /ticket panel ────────────────────────────────────────────────────────────

	public async chatInputPanel(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}
		if (!this.checkAdmin(interaction)) return;

		try {
			await postTicketPanel(interaction.guild);
			return interaction.editReply(successReply('Ticket panel posted successfully.'));
		} catch (err) {
			this.container.logger.error(err);
			return interaction.editReply(errorReply(friendlyTicketError(err)));
		}
	}

	// ── /ticket close ────────────────────────────────────────────────────────────

	public async chatInputClose(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}

		const targetChannel =
			(interaction.options.getChannel('channel') as TextChannel | null) ?? (interaction.channel as TextChannel);

		// Look up ticket by channel ID
		const ticket = await db
			.select()
			.from(schema.tickets)
			.where(and(eq(schema.tickets.channelId, targetChannel.id), eq(schema.tickets.status, 'open')))
			.limit(1)
			.then((r) => r[0] ?? null);

		if (!ticket) {
			return interaction.editReply(errorReply(`<#${targetChannel.id}> is not an open ticket channel.`));
		}

		try {
			await closeTicket(interaction.guild, ticket.id, interaction.member);
			return interaction.editReply(successReply(`Ticket #${ticket.id} has been closed.`));
		} catch (err) {
			this.container.logger.error(err);
			return interaction.editReply(errorReply(friendlyTicketError(err)));
		}
	}

	// ── /ticket add ──────────────────────────────────────────────────────────────

	public async chatInputAdd(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}

		const user = interaction.options.getUser('user', true);
		const targetChannel =
			(interaction.options.getChannel('channel') as TextChannel | null) ?? (interaction.channel as TextChannel);

		// Verify this is an open ticket channel
		const ticket = await db
			.select()
			.from(schema.tickets)
			.where(and(eq(schema.tickets.channelId, targetChannel.id), eq(schema.tickets.status, 'open')))
			.limit(1)
			.then((r) => r[0] ?? null);

		if (!ticket) {
			return interaction.editReply(errorReply(`<#${targetChannel.id}> is not an open ticket channel.`));
		}

		try {
			await targetChannel.permissionOverwrites.edit(user.id, {
				ViewChannel: true,
				SendMessages: true,
				ReadMessageHistory: true,
				AttachFiles: true,
				EmbedLinks: true,
				AddReactions: true,
			});

			const addedMsg = makeContainer({ color: Colors.Success });
			addedMsg.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`✅ ${userMention(user.id)} has been added to this ticket by ${userMention(interaction.user.id)}.`,
				),
			);
			await targetChannel.send({ components: [addedMsg], flags: CV2_FLAG }).catch(() => null);

			return interaction.editReply(successReply(`${user.tag} added to <#${targetChannel.id}>.`));
		} catch (err) {
			this.container.logger.error(err);
			return interaction.editReply(errorReply('Failed to add user to ticket.'));
		}
	}

	// ── /ticket remove ───────────────────────────────────────────────────────────

	public async chatInputRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}

		const user = interaction.options.getUser('user', true);
		const targetChannel =
			(interaction.options.getChannel('channel') as TextChannel | null) ?? (interaction.channel as TextChannel);

		// Verify this is an open ticket channel
		const ticket = await db
			.select()
			.from(schema.tickets)
			.where(and(eq(schema.tickets.channelId, targetChannel.id), eq(schema.tickets.status, 'open')))
			.limit(1)
			.then((r) => r[0] ?? null);

		if (!ticket) {
			return interaction.editReply(errorReply(`<#${targetChannel.id}> is not an open ticket channel.`));
		}

		// Don't remove the original ticket owner
		if (ticket.userId === user.id) {
			return interaction.editReply(warningReply('You cannot remove the ticket owner.'));
		}

		try {
			await targetChannel.permissionOverwrites.delete(user.id);

			const removedMsg = makeContainer({ color: Colors.Warning });
			removedMsg.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`⚠️ ${userMention(user.id)} has been removed from this ticket by ${userMention(interaction.user.id)}.`,
				),
			);
			await targetChannel.send({ components: [removedMsg], flags: CV2_FLAG }).catch(() => null);

			return interaction.editReply(successReply(`${user.tag} removed from <#${targetChannel.id}>.`));
		} catch (err) {
			this.container.logger.error(err);
			return interaction.editReply(errorReply('Failed to remove user from ticket.'));
		}
	}

	// ── /ticket reviews channel ──────────────────────────────────────────────────

	public async chatInputSetReviewsChannel(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild())
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		if (!this.checkAdmin(interaction)) return;

		const channel = interaction.options.getChannel('channel');
		await upsertReviewSettings(interaction.guildId, { channelId: channel?.id ?? null });
		return interaction.editReply(
			channel ? successReply(`Reviews will be posted in <#${channel.id}>.`) : successReply('Reviews channel cleared.'),
		);
	}

	private async upsertGuild(guildId: string, patch: Partial<typeof schema.guilds.$inferInsert>) {
		await db
			.insert(schema.guilds)
			.values({ id: guildId, ...patch })
			.onDuplicateKeyUpdate({
				set: patch,
			});
	}

	public async chatInputSetTicketLogChannel(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}
		if (!this.checkAdmin(interaction)) return;

		const channel = interaction.options.getChannel('channel') as TextChannel | null;

		// Fetch the current row to find any existing webhook URL we should clean up
		const [row] = await db.select().from(schema.guilds).where(eq(schema.guilds.id, interaction.guildId)).limit(1);

		const existingUrl = row?.ticketLogWebhookUrl ?? null;
		if (existingUrl) {
			await tryDeleteWebhook(existingUrl);
		}

		if (!channel) {
			await this.upsertGuild(interaction.guildId, { ticketLogWebhookUrl: null });
			return interaction.editReply(successReply('Ticket log channel cleared.'));
		}

		// Create a new webhook using the bot's avatar
		let webhookUrl: string;
		try {
			const avatarUrl = interaction.client.user.displayAvatarURL({ extension: 'png', size: 256 });
			const wh = await channel.createWebhook({
				name: 'Erica — Ticket Logs',
				avatar: avatarUrl,
				reason: `Set by ${interaction.user.tag} via /ticket`,
			});
			webhookUrl = wh.url;
		} catch {
			return interaction.editReply(
				errorReply(
					`Failed to create a webhook in <#${channel.id}>. Make sure I have the **Manage Webhooks** permission in that channel.`,
				),
			);
		}

		await this.upsertGuild(interaction.guildId, { ticketLogWebhookUrl: webhookUrl });
		return interaction.editReply(successReply(`Ticket logs will be posted in <#${channel.id}>.`));
	}

	// ── /ticket stats ────────────────────────────────────────────────────────────

	public async chatInputStats(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}

		const timeframe = (interaction.options.getString('timeframe') ?? '30d') as TicketStatsTimeframe;
		const staffUser = interaction.options.getUser('staff');
		const botId = interaction.client.user?.id ?? null;
		const tf = timeframeLabel(timeframe);

		if (staffUser) {
			const stats = await getStaffMemberTicketStats(interaction.guildId, staffUser.id, timeframe);
			const c = makeContainer({ color: Colors.Ticket, header: `Support Stats (${tf}) — ${staffUser.username}` });
			c.addSeparatorComponents(separator());
			c.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					[
						userMention(staffUser.id),
						'',
						`**Tickets closed** ${stats.closedCount}`,
						`**Claimed** ${stats.claimedCount}`,
						`**Avg close time** ${formatDuration(stats.avgCloseMs)}`,
						`**Reviews** ${stats.reviewCount}${stats.avgRating != null ? ` · **avg ${stats.avgRating.toFixed(2)}/5**` : ''}`,
					].join('\n'),
				),
			);
			return interaction.editReply(cv2Reply(c, true));
		}

		const [guildStats, staffStats] = await Promise.all([
			getGuildTicketStats(interaction.guildId, timeframe, botId),
			getStaffTicketStats(interaction.guildId, timeframe, botId, 15),
		]);

		const stars = ([5, 4, 3, 2, 1] as const).map((n) => `${'⭐'.repeat(n)} ${guildStats.ratingCounts[n]}`).join(' · ');

		const c = makeContainer({ color: Colors.Ticket, header: `Support Statistics (${tf})` });
		c.addSeparatorComponents(separator());
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				[
					`**Open tickets** ${guildStats.openTickets}`,
					`**Closed** ${guildStats.closedTickets}`,
					`**Avg close time** ${formatDuration(guildStats.avgCloseMs)}`,
					`**Reviews** ${guildStats.reviewCount}${
						guildStats.avgRating != null ? ` · **avg ${guildStats.avgRating.toFixed(2)}/5**` : ''
					}`,
					guildStats.reviewCount > 0 ? `-# ${stars}` : null,
				]
					.filter(Boolean)
					.join('\n'),
			),
		);

		if (staffStats.length > 0) {
			c.addSeparatorComponents(separator());
			c.addTextDisplayComponents(new TextDisplayBuilder().setContent('### Staff'));
			const lines = staffStats
				.map((s, i) => {
					const rating = s.avgRating != null ? ` · ⭐ ${s.avgRating.toFixed(2)} (${s.reviewCount})` : '';
					return `**${i + 1}.** ${userMention(s.staffId)} — **${s.claimedCount}** claimed · **${s.closedCount}** closed · avg ${formatDuration(s.avgCloseMs)}${rating}`;
				})
				.join('\n');
			c.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines));
			c.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					'-# Claimed = tickets claimed by staff. Closed attribution = claimer when claimed, otherwise closer (excludes opener self-closes & the bot).',
				),
			);
		}

		return interaction.editReply(cv2Reply(c, true));
	}

	// ── /ticket togglereviews ────────────────────────────────────────────────────

	public async chatInputToggleReviews(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild())
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		if (!this.checkAdmin(interaction)) return;

		const settings = await getReviewSettings(interaction.guildId);
		if (!settings?.channelId) {
			return interaction.editReply(warningReply('Set a reviews channel first with `/ticket reviews channel`.'));
		}

		const newEnabled = !settings.enabled;
		await upsertReviewSettings(interaction.guildId, { enabled: newEnabled });
		return interaction.editReply(
			successReply(
				`Review requests ${newEnabled ? 'enabled ✅' : 'disabled ❌'} — users will${newEnabled ? '' : ' not'} be asked to rate their experience after a ticket closes.`,
			),
		);
	}

	// ── /ticket blacklist add ─────────────────────────────────────────────────────

	public async chatInputBlacklistAdd(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild())
			return interaction.editReply(errorReply('This command can only be used in a server.'));

		const target = interaction.options.getUser('user', true);
		const reason = interaction.options.getString('reason') ?? 'No reason provided';

		if (target.bot) return interaction.editReply(errorReply('You cannot blacklist a bot account.'));
		if (target.id === interaction.user.id) return interaction.editReply(errorReply('You cannot blacklist yourself.'));

		const existing = await db
			.select()
			.from(schema.supportBlacklist)
			.where(
				and(eq(schema.supportBlacklist.guildId, interaction.guildId), eq(schema.supportBlacklist.userId, target.id)),
			)
			.limit(1)
			.then((r) => r[0] ?? null);

		if (existing) {
			return interaction.editReply(
				warningReply(`${userMention(target.id)} is already support-blacklisted in this server.`),
			);
		}

		await db.insert(schema.supportBlacklist).values({
			guildId: interaction.guildId,
			userId: target.id,
			reason,
			addedById: interaction.user.id,
		});

		return interaction.editReply(
			successReply(`**${target.tag}** (\`${target.id}\`) can no longer open support tickets.\nReason: ${reason}`),
		);
	}

	// ── /ticket blacklistremove ───────────────────────────────────────────────────

	public async chatInputBlacklistRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild())
			return interaction.editReply(errorReply('This command can only be used in a server.'));

		const target = interaction.options.getUser('user', true);

		const result = await db
			.delete(schema.supportBlacklist)
			.where(
				and(eq(schema.supportBlacklist.guildId, interaction.guildId), eq(schema.supportBlacklist.userId, target.id)),
			);
		const affected = Number((result as any)[0]?.affectedRows ?? 0);

		if (affected === 0) {
			return interaction.editReply(warningReply(`${userMention(target.id)} is not on the support blacklist.`));
		}

		return interaction.editReply(
			successReply(`**${target.tag}** (\`${target.id}\`) can now open support tickets again.`),
		);
	}

	// ── /ticket blacklistlist ─────────────────────────────────────────────────────

	public async chatInputBlacklistList(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild())
			return interaction.editReply(errorReply('This command can only be used in a server.'));

		const entries = await db
			.select()
			.from(schema.supportBlacklist)
			.where(eq(schema.supportBlacklist.guildId, interaction.guildId))
			.orderBy(schema.supportBlacklist.createdAt);

		if (entries.length === 0) {
			return interaction.editReply(warningReply('No users are currently support-blacklisted in this server.'));
		}

		const lines = entries.map((e, i) => {
			const ts = time(Math.floor(e.createdAt.getTime() / 1000), TimestampStyles.ShortDate);
			return `\`${i + 1}.\` <@${e.userId}> (\`${e.userId}\`) — ${e.reason} — added by <@${e.addedById}> ${ts}`;
		});

		return interaction.editReply(
			`**Support Blacklist** (${entries.length} entr${entries.length === 1 ? 'y' : 'ies'})\n\n${lines.join('\n')}`,
		);
	}

	// ── /ticket reload ───────────────────────────────────────────────────────────

	public async chatInputReload(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}
		if (!this.checkAdmin(interaction)) return;

		try {
			reloadTicketsConfig();
			const settings = getTicketSettingsFromConfig(interaction.guildId);
			const categories = getGuildCategoriesFromConfig(interaction.guildId);
			if (!settings) {
				return interaction.editReply(
					warningReply('Config reloaded, but it does not apply to this server (guildId mismatch).'),
				);
			}
			await updateTicketStatsChannels(interaction.guild).catch(() => null);
			return interaction.editReply(
				successReply(
					`Reloaded tickets.yml — ${categories.length} categor${categories.length === 1 ? 'y' : 'ies'}, panel <#${settings.panelChannelId}>.`,
				),
			);
		} catch (err) {
			this.container.logger.error(err);
			return interaction.editReply(errorReply(err instanceof Error ? err.message : 'Failed to reload tickets.yml'));
		}
	}
}
