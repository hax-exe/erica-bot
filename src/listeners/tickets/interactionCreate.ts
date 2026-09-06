import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import {
	ActionRowBuilder,
	ButtonBuilder,
	type ButtonInteraction,
	ButtonStyle,
	Events,
	type Guild,
	GuildMember,
	type Interaction,
	MessageFlags,
	type ModalSubmitInteraction,
	type StringSelectMenuInteraction,
	TextDisplayBuilder,
} from 'discord.js';
import { and, eq, isNull } from 'drizzle-orm';
import { getBotBlacklistEntry, isBotBlacklisted } from '../../lib/BlacklistUtil.js';
import {
	Colors,
	CV2_FLAG,
	errorReply,
	makeContainer,
	separator,
	successReply,
	warningReply,
} from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';
import {
	assertTicketOpenerAllowed,
	buildPanelPayload,
	buildTicketModal,
	canOpenTicket,
	closeTicket,
	collectTicketForm,
	friendlyTicketError,
	getCategoryById,
	getGuildCategories,
	getTicketSettings,
	modalId,
	openTicket,
	reopenTicket,
	TICKET_CLOSE_CANCEL_ID,
	TICKET_CLOSE_CONFIRM_ID,
	TICKET_CLOSE_ID,
	TICKET_DELETE_CANCEL_ID,
	TICKET_DELETE_CONFIRM_ID,
	TICKET_DELETE_ID,
	TICKET_MODAL_PREFIX,
	TICKET_REOPEN_CANCEL_ID,
	TICKET_REOPEN_CONFIRM_ID,
	TICKET_REOPEN_ID,
	TICKET_SELECT_ID,
} from '../../lib/TicketManager.js';

const TICKET_CHAT_ACCESS = {
	ViewChannel: true,
	SendMessages: true,
	ReadMessageHistory: true,
	AttachFiles: true,
	EmbedLinks: true,
	AddReactions: true,
} as const;

async function lockTicketToClaimant(
	guild: Guild,
	channelId: string,
	openerId: string,
	claimantId: string,
	staffRoleIds: string[],
): Promise<void> {
	const channel = await guild.channels.fetch(channelId);
	if (!channel || !('permissionOverwrites' in channel)) throw new Error('Ticket channel not found.');

	for (const roleId of staffRoleIds) {
		await channel.permissionOverwrites.edit(roleId, {
			ViewChannel: true,
			ReadMessageHistory: true,
			ManageMessages: true,
			SendMessages: false,
			AddReactions: false,
		});
	}

	await channel.permissionOverwrites.edit(openerId, TICKET_CHAT_ACCESS);
	await channel.permissionOverwrites.edit(claimantId, TICKET_CHAT_ACCESS);
	if (guild.members.me) await channel.permissionOverwrites.edit(guild.members.me.id, TICKET_CHAT_ACCESS);
}

async function unlockTicketStaffChat(
	guild: Guild,
	channelId: string,
	openerId: string,
	claimantId: string,
	staffRoleIds: string[],
): Promise<void> {
	const channel = await guild.channels.fetch(channelId);
	if (!channel || !('permissionOverwrites' in channel)) throw new Error('Ticket channel not found.');

	for (const roleId of staffRoleIds) {
		await channel.permissionOverwrites.edit(roleId, {
			ViewChannel: true,
			SendMessages: true,
			ReadMessageHistory: true,
			AttachFiles: true,
			EmbedLinks: true,
			AddReactions: true,
			ManageMessages: true,
		});
	}

	if (claimantId !== openerId) {
		await channel.permissionOverwrites.delete(claimantId, 'Ticket claim released');
	}
	await channel.permissionOverwrites.edit(openerId, TICKET_CHAT_ACCESS);
}

const STAFF_TICKET_SELECT_PREFIX = 'ticket:staff:select:';

// Helper: safely call reply() with our InteractionEditReplyOptions
function r(opts: ReturnType<typeof errorReply>) {
	return opts as any;
}

@ApplyOptions<Listener.Options>({
	name: 'ticketInteractions',
	event: Events.InteractionCreate,
})
export class TicketInteractionListener extends Listener<typeof Events.InteractionCreate> {
	public override async run(interaction: Interaction) {
		if (!interaction.inCachedGuild()) return;
		if (await isBotBlacklisted(interaction.user.id)) return;

		try {
			await this.dispatch(interaction);
		} catch (err: any) {
			// Stale / destroyed-channel interactions — silently discard
			// 10062 = Unknown Interaction, 40060 = already acknowledged,
			// 10008 = Unknown Message (deferred reply whose original was deleted),
			// 10003 = Unknown Channel (ticket channel was deleted mid-interaction)
			if (err?.code === 10062 || err?.code === 40060 || err?.code === 10008 || err?.code === 10003) {
				this.container.logger.debug(`[ticketInteractions] Interaction discarded (code ${err.code}).`);
				return;
			}
			throw err;
		}
	}

	private async dispatch(interaction: Interaction) {
		if (!interaction.inCachedGuild()) return;
		if (!(await isModuleEnabled(interaction.guildId, 'tickets'))) return;

		// ── Select menu: category chosen ────────────────────────────────────────────
		if (interaction.isStringSelectMenu() && interaction.customId === TICKET_SELECT_ID) {
			const categoryId = interaction.values[0];
			await this.handleSelect(interaction as StringSelectMenuInteraction<'cached'>, categoryId);
			return;
		}

		// ── Staff: open ticket for another user ─────────────────────────────────────
		if (interaction.isStringSelectMenu() && interaction.customId.startsWith(STAFF_TICKET_SELECT_PREFIX)) {
			const targetUserId = interaction.customId.slice(STAFF_TICKET_SELECT_PREFIX.length);
			const categoryId = interaction.values[0];
			await this.handleStaffOpen(interaction as StringSelectMenuInteraction<'cached'>, targetUserId, categoryId);
			return;
		}

		// ── Modal submit: questionnaire answered ────────────────────────────────────
		if (interaction.isModalSubmit() && interaction.customId.startsWith(TICKET_MODAL_PREFIX)) {
			const rest = interaction.customId.slice(TICKET_MODAL_PREFIX.length);
			const colonIdx = rest.indexOf(':');
			const categoryId = colonIdx >= 0 ? rest.slice(0, colonIdx) : rest;
			const panelMessageId = colonIdx >= 0 ? rest.slice(colonIdx + 1) : '';
			await this.handleModalSubmit(interaction as ModalSubmitInteraction<'cached'>, categoryId, panelMessageId);
			return;
		}

		if (!interaction.isButton()) return;

		const id = interaction.customId;

		// Check confirm/cancel BEFORE the generic close — confirm ID starts with close ID
		if (id.startsWith(`${TICKET_CLOSE_CONFIRM_ID}:`)) {
			const ticketId = parseInt(id.split(':')[3], 10);
			await this.handleCloseConfirm(interaction as ButtonInteraction<'cached'>, ticketId);
			return;
		}

		if (id === TICKET_CLOSE_CANCEL_ID || id.startsWith(`${TICKET_CLOSE_CANCEL_ID}:`)) {
			const cancelContainer = makeContainer({ color: Colors.Neutral });
			cancelContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent('Ticket close cancelled.'));
			await interaction.update({ components: [cancelContainer], flags: CV2_FLAG } as any);
			return;
		}

		if (id.startsWith(`${TICKET_DELETE_CONFIRM_ID}:`)) {
			const ticketId = parseInt(id.split(':')[3], 10);
			await this.handleDeleteConfirm(interaction as ButtonInteraction<'cached'>, ticketId);
			return;
		}

		if (id === TICKET_DELETE_CANCEL_ID || id.startsWith(`${TICKET_DELETE_CANCEL_ID}:`)) {
			const ticketId = parseInt(id.split(':')[3] ?? id.split(':')[2], 10);
			await this.handleDeleteCancel(interaction as ButtonInteraction<'cached'>, ticketId);
			return;
		}

		if (id.startsWith(`${TICKET_DELETE_ID}:`)) {
			const ticketId = parseInt(id.split(':')[2], 10);
			await this.handleDeleteRequest(interaction as ButtonInteraction<'cached'>, ticketId);
			return;
		}

		if (id.startsWith(`${TICKET_REOPEN_CONFIRM_ID}:`)) {
			const ticketId = parseInt(id.split(':')[3], 10);
			await this.handleReopenConfirm(interaction as ButtonInteraction<'cached'>, ticketId);
			return;
		}

		if (id === TICKET_REOPEN_CANCEL_ID || id.startsWith(`${TICKET_REOPEN_CANCEL_ID}:`)) {
			const cancelContainer = makeContainer({ color: Colors.Neutral });
			cancelContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent('Ticket reopen cancelled.'));
			await interaction.update({ components: [cancelContainer], flags: CV2_FLAG } as any);
			return;
		}

		if (id.startsWith(`${TICKET_REOPEN_ID}:`)) {
			const ticketId = parseInt(id.split(':')[2], 10);
			await this.handleReopenRequest(interaction as ButtonInteraction<'cached'>, ticketId);
			return;
		}

		if (id.startsWith(`${TICKET_CLOSE_ID}:`)) {
			const ticketId = parseInt(id.split(':')[2], 10);
			await this.handleCloseRequest(interaction as ButtonInteraction<'cached'>, ticketId);
			return;
		}

		if (id.startsWith(`ticket:claim:`)) {
			const ticketId = parseInt(id.split(':')[2], 10);
			await this.handleClaimRequest(interaction as ButtonInteraction<'cached'>, ticketId);
			return;
		}

		if (id.startsWith(`ticket:unclaim:`)) {
			const ticketId = parseInt(id.split(':')[2], 10);
			await this.handleUnclaimRequest(interaction as ButtonInteraction<'cached'>, ticketId);
			return;
		}

		if (id === 'ticket:appeal') {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			const categories = await getGuildCategories(interaction.guild.id);
			if (categories.length === 0) {
				await interaction.editReply(r(errorReply('No ticket categories are configured on this server.')));
				return;
			}
			const cat = categories.find(
				(c) => c.categoryId.toLowerCase().includes('appeal') || c.label.toLowerCase().includes('appeal'),
			);
			if (!cat) {
				await interaction.editReply(
					r(
						errorReply(
							'No **appeal** ticket category is set up. Ask staff to create one, or open a ticket from the panel.',
						),
					),
				);
				return;
			}

			try {
				await assertTicketOpenerAllowed(interaction.guild.id, interaction.user.id);
			} catch (err) {
				await interaction.editReply(r(errorReply(friendlyTicketError(err))));
				return;
			}

			const alreadyOpen = !(await canOpenTicket(
				interaction.guild.id,
				interaction.user.id,
				cat.categoryId,
				cat.maxOpenTickets,
			));
			if (alreadyOpen) {
				await interaction.editReply(
					r(
						warningReply(
							`You already have the maximum number of open **${cat.label}** tickets (${cat.maxOpenTickets}).`,
						),
					),
				);
				return;
			}

			try {
				const channel = await openTicket(interaction.guild, interaction.member, cat.categoryId);
				await interaction.editReply(r(successReply(`Appeal ticket opened: <#${channel.id}>`)));
			} catch (err) {
				this.container.logger.error(err);
				await interaction.editReply(r(errorReply(friendlyTicketError(err))));
			}
			return;
		}
	}

	// ─── Category selected ────────────────────────────────────────────────────────

	private async handleSelect(interaction: StringSelectMenuInteraction<'cached'>, categoryId: string) {
		// Fetch settings and categories for this guild so we can rebuild the panel payload
		const settings = await getTicketSettings(interaction.guild.id);
		const categories = await getGuildCategories(interaction.guild.id);
		const panelPayload =
			settings && categories.length > 0
				? (buildPanelPayload(settings, categories) as any)
				: { content: 'The ticket system is not fully configured.', flags: 64 };

		const cat = categories.find((c) => c.categoryId === categoryId) ?? null;
		if (!cat) {
			await interaction.update(panelPayload);
			await interaction.followUp(r(errorReply('This ticket category no longer exists in the config.')));
			return;
		}

		try {
			await assertTicketOpenerAllowed(interaction.guild.id, interaction.user.id);
		} catch (err) {
			await interaction.update(panelPayload);
			await interaction.followUp(r(errorReply(friendlyTicketError(err))));
			return;
		}

		const alreadyOpen = !(await canOpenTicket(
			interaction.guild.id,
			interaction.user.id,
			categoryId,
			cat.maxOpenTickets,
		));
		if (alreadyOpen) {
			await interaction.update(panelPayload);
			await interaction.followUp(
				r(
					warningReply(
						`You already have the maximum number of open **${cat.label}** tickets (${cat.maxOpenTickets}). Please close one before opening another.`,
					),
				),
			);
			return;
		}

		// If the category has questions, show a modal (panel resets after modal submit).
		// Encode the panel message ID in the modal custom ID so it survives bot restarts.
		if (cat.questions.length > 0) {
			const modal = buildTicketModal(cat, modalId(categoryId, interaction.message.id));
			return interaction.showModal(modal);
		}

		// No questions — reset panel immediately then open ticket
		await interaction.update(panelPayload);

		try {
			const channel = await openTicket(interaction.guild, interaction.member, categoryId);
			await interaction.followUp(r(successReply(`Your ticket has been created: <#${channel.id}>`, true)));
		} catch (err) {
			this.container.logger.error(err);
			await interaction.followUp(r(errorReply(friendlyTicketError(err))));
		}
	}

	// ─── Modal submit ─────────────────────────────────────────────────────────────

	private async handleModalSubmit(
		interaction: ModalSubmitInteraction<'cached'>,
		categoryId: string,
		panelMessageId: string,
	) {
		const cat = await getCategoryById(interaction.guild.id, categoryId);
		if (!cat) {
			return interaction.reply(r(errorReply('This ticket category no longer exists.')));
		}

		// Re-check blacklists (user may have been banned after the modal opened)
		try {
			await assertTicketOpenerAllowed(interaction.guild.id, interaction.user.id);
		} catch (err) {
			return interaction.reply(r(errorReply(friendlyTicketError(err))));
		}

		const alreadyOpen = !(await canOpenTicket(
			interaction.guild.id,
			interaction.user.id,
			categoryId,
			cat.maxOpenTickets,
		));
		if (alreadyOpen) {
			return interaction.reply(
				r(
					warningReply(`You already have the maximum number of open **${cat.label}** tickets (${cat.maxOpenTickets}).`),
				),
			);
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const form = collectTicketForm(interaction, cat.questions);

		// Ensure the member object is available
		const member =
			interaction.member instanceof GuildMember
				? interaction.member
				: await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

		if (!member) {
			return interaction.editReply(errorReply('Could not resolve your guild membership.'));
		}

		try {
			const channel = await openTicket(interaction.guild, member, categoryId, form);
			// Reset the panel message so the select menu is cleared
			if (panelMessageId) {
				const settings = await getTicketSettings(interaction.guild.id);
				if (settings?.panelChannelId) {
					const panelCh = interaction.guild.channels.cache.get(settings.panelChannelId);
					if (panelCh?.isTextBased()) {
						const panelMsg = await panelCh.messages.fetch(panelMessageId).catch(() => null);
						if (panelMsg) {
							const cats = await getGuildCategories(interaction.guild.id);
							await panelMsg.edit(buildPanelPayload(settings, cats) as any).catch(() => null);
						}
					}
				}
			}
			return interaction.editReply(successReply(`Your ticket has been created: <#${channel.id}>`));
		} catch (err) {
			this.container.logger.error(err);
			return interaction.editReply(errorReply(friendlyTicketError(err)));
		}
	}

	// ─── Close request ────────────────────────────────────────────────────────────

	private async handleCloseRequest(interaction: ButtonInteraction<'cached'>, ticketId: number) {
		const ticket = await db
			.select()
			.from(schema.tickets)
			.where(and(eq(schema.tickets.id, ticketId), eq(schema.tickets.status, 'open')))
			.limit(1)
			.then((rs) => rs[0] ?? null);

		if (!ticket) {
			const closedTicket = await db
				.select({ channelId: schema.tickets.channelId })
				.from(schema.tickets)
				.where(and(eq(schema.tickets.id, ticketId), eq(schema.tickets.status, 'closed')))
				.limit(1)
				.then((rows) => rows[0] ?? null);
			if (closedTicket?.channelId === interaction.channelId) {
				return this.handleDeleteRequest(interaction, ticketId);
			}
			return interaction.reply(r(errorReply('This ticket is already closed or does not exist.')));
		}

		const isOwner = ticket.userId === interaction.user.id;
		const cat = await getCategoryById(interaction.guild.id, ticket.categoryId);
		const isStaff = cat?.staffRoleIds.some((id) => interaction.member.roles.cache.has(id)) ?? false;
		const isAdmin = interaction.memberPermissions?.has('ManageChannels') ?? false;

		if (!isOwner && !isStaff && !isAdmin) {
			return interaction.reply(r(errorReply('Only the ticket owner or staff can close this ticket.')));
		}

		const settings = await getTicketSettings(interaction.guild.id);
		const archiveNote = settings?.closedCategoryId
			? 'A transcript will be saved and the channel will be moved to the archive category.'
			: 'A transcript will be saved and the channel will be deleted.';

		// Skip confirmation when disabled in ticket settings
		if (settings && settings.closeConfirmation === false) {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			try {
				await closeTicket(interaction.guild, ticketId, interaction.member);
				return interaction.editReply(r(successReply('Ticket closed. The transcript has been saved.')));
			} catch (err) {
				this.container.logger.error(err);
				return interaction.editReply(r(errorReply(friendlyTicketError(err))));
			}
		}

		const confirmContainer = makeContainer({ color: Colors.Warning, header: 'Close Ticket?' });
		confirmContainer.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(`Are you sure you want to close this ticket?\n${archiveNote}`),
		);
		confirmContainer.addSeparatorComponents(separator());
		confirmContainer.addActionRowComponents(
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId(`${TICKET_CLOSE_CONFIRM_ID}:${ticketId}`)
					.setLabel('Close Ticket')
					.setStyle(ButtonStyle.Danger),
				new ButtonBuilder()
					.setCustomId(`${TICKET_CLOSE_CANCEL_ID}:${ticketId}`)
					.setLabel('Cancel')
					.setStyle(ButtonStyle.Secondary),
			),
		);

		return interaction.reply({ components: [confirmContainer], flags: CV2_FLAG | MessageFlags.Ephemeral });
	}

	// ─── Close confirm ────────────────────────────────────────────────────────────

	private async handleCloseConfirm(interaction: ButtonInteraction<'cached'>, ticketId: number) {
		await interaction.deferUpdate();

		try {
			await closeTicket(interaction.guild, ticketId, interaction.member);
			const doneContainer = makeContainer({ color: Colors.Success });
			doneContainer.addTextDisplayComponents(
				new TextDisplayBuilder().setContent('✅ Ticket closed. The transcript has been saved.'),
			);
			await interaction.editReply({ components: [doneContainer], flags: CV2_FLAG } as any);
		} catch (err) {
			this.container.logger.error(err);
			await interaction.followUp(r(errorReply(friendlyTicketError(err))));
		}
	}

	// ─── Delete archived ticket ───────────────────────────────────────────────────

	private async assertClosedTicketStaff(
		interaction: ButtonInteraction<'cached'>,
		ticketId: number,
	): Promise<{ ok: true } | { ok: false; message: string }> {
		const ticket = await db
			.select()
			.from(schema.tickets)
			.where(and(eq(schema.tickets.id, ticketId), eq(schema.tickets.status, 'closed')))
			.limit(1)
			.then((rows) => rows[0] ?? null);

		if (!ticket || ticket.channelId !== interaction.channelId) {
			return { ok: false, message: 'This closed ticket could not be found.' };
		}

		const cat = await getCategoryById(interaction.guild.id, ticket.categoryId);
		const isStaff = cat?.staffRoleIds.some((id) => interaction.member.roles.cache.has(id)) ?? false;
		const isAdmin = interaction.memberPermissions?.has('ManageChannels') ?? false;
		if (!isStaff && !isAdmin) {
			return { ok: false, message: 'Only ticket staff can manage archived tickets.' };
		}

		return { ok: true };
	}

	private buildArchiveActions(ticketId: number) {
		const container = makeContainer({ color: Colors.Neutral });
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				'This ticket is closed and archived. Staff can reopen it or permanently delete the channel.',
			),
		);
		container.addSeparatorComponents(separator());
		container.addActionRowComponents(
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId(`${TICKET_REOPEN_ID}:${ticketId}`)
					.setLabel('Reopen')
					.setStyle(ButtonStyle.Success),
				new ButtonBuilder()
					.setCustomId(`${TICKET_DELETE_ID}:${ticketId}`)
					.setLabel('Delete Ticket')
					.setStyle(ButtonStyle.Danger),
			),
		);
		return container;
	}

	private async handleDeleteRequest(interaction: ButtonInteraction<'cached'>, ticketId: number) {
		const check = await this.assertClosedTicketStaff(interaction, ticketId);
		if (!check.ok) {
			return interaction.reply(r(errorReply(check.message)));
		}

		const confirmContainer = makeContainer({ color: Colors.Warning, header: 'Confirm Delete?' });
		confirmContainer.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				'**Are you sure?** This permanently deletes the Discord channel.\nSaved HTML/text transcripts will remain available.\n\nClick **Yes, Delete Permanently** to continue, or **Cancel** to keep the channel.',
			),
		);
		confirmContainer.addSeparatorComponents(separator());
		confirmContainer.addActionRowComponents(
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId(`${TICKET_DELETE_CONFIRM_ID}:${ticketId}`)
					.setLabel('Yes, Delete Permanently')
					.setStyle(ButtonStyle.Danger),
				new ButtonBuilder()
					.setCustomId(`${TICKET_DELETE_CANCEL_ID}:${ticketId}`)
					.setLabel('Cancel')
					.setStyle(ButtonStyle.Secondary),
			),
		);

		// Replace the archive notice in-channel so delete always requires a second click.
		return interaction.update({ components: [confirmContainer], flags: CV2_FLAG } as any);
	}

	private async handleDeleteCancel(interaction: ButtonInteraction<'cached'>, ticketId: number) {
		const check = await this.assertClosedTicketStaff(interaction, ticketId);
		if (!check.ok) {
			return interaction.update(r(errorReply(check.message)));
		}

		return interaction.update({
			components: [this.buildArchiveActions(ticketId)],
			flags: CV2_FLAG,
		} as any);
	}

	private async handleDeleteConfirm(interaction: ButtonInteraction<'cached'>, ticketId: number) {
		const check = await this.assertClosedTicketStaff(interaction, ticketId);
		if (!check.ok) {
			return interaction.update(r(errorReply(check.message)));
		}

		const doneContainer = makeContainer({ color: Colors.Error, header: 'Deleting…' });
		doneContainer.addTextDisplayComponents(
			new TextDisplayBuilder().setContent('Deletion confirmed. This channel will be removed shortly.'),
		);
		await interaction.update({ components: [doneContainer], flags: CV2_FLAG } as any);
		await new Promise<void>((resolve) => setTimeout(resolve, 1500));
		await interaction.channel?.delete('Archived ticket deleted by staff');
	}

	// ─── Reopen archived ticket ───────────────────────────────────────────────────

	private async handleReopenRequest(interaction: ButtonInteraction<'cached'>, ticketId: number) {
		const ticket = await db
			.select()
			.from(schema.tickets)
			.where(and(eq(schema.tickets.id, ticketId), eq(schema.tickets.status, 'closed')))
			.limit(1)
			.then((rows) => rows[0] ?? null);

		if (!ticket || ticket.channelId !== interaction.channelId) {
			return interaction.reply(r(errorReply('This closed ticket could not be found.')));
		}

		const cat = await getCategoryById(interaction.guild.id, ticket.categoryId);
		const isStaff = cat?.staffRoleIds.some((id) => interaction.member.roles.cache.has(id)) ?? false;
		const isAdmin = interaction.memberPermissions?.has('ManageChannels') ?? false;
		if (!isStaff && !isAdmin) {
			return interaction.reply(r(errorReply('Only ticket staff can reopen archived tickets.')));
		}

		const confirmContainer = makeContainer({ color: Colors.Warning, header: 'Reopen Ticket?' });
		confirmContainer.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				'This will move the channel back to its open category and allow conversation again.',
			),
		);
		confirmContainer.addSeparatorComponents(separator());
		confirmContainer.addActionRowComponents(
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId(`${TICKET_REOPEN_CONFIRM_ID}:${ticketId}`)
					.setLabel('Reopen Ticket')
					.setStyle(ButtonStyle.Success),
				new ButtonBuilder()
					.setCustomId(`${TICKET_REOPEN_CANCEL_ID}:${ticketId}`)
					.setLabel('Cancel')
					.setStyle(ButtonStyle.Secondary),
			),
		);

		return interaction.reply({ components: [confirmContainer], flags: CV2_FLAG | MessageFlags.Ephemeral });
	}

	private async handleReopenConfirm(interaction: ButtonInteraction<'cached'>, ticketId: number) {
		await interaction.deferUpdate();

		try {
			await reopenTicket(interaction.guild, ticketId, interaction.member);
			const doneContainer = makeContainer({ color: Colors.Success });
			doneContainer.addTextDisplayComponents(
				new TextDisplayBuilder().setContent('Ticket reopened. The channel is active again.'),
			);
			await interaction.editReply({ components: [doneContainer], flags: CV2_FLAG } as any);
		} catch (err) {
			this.container.logger.error(err);
			await interaction.followUp(r(errorReply(friendlyTicketError(err))));
		}
	}

	// ─── Staff: open ticket on behalf of another user ──────────────────────────────

	private async handleStaffOpen(
		interaction: StringSelectMenuInteraction<'cached'>,
		targetUserId: string,
		categoryId: string,
	) {
		await interaction.deferUpdate();

		const cat = await getCategoryById(interaction.guild.id, categoryId);
		if (!cat) {
			await interaction.followUp(r(errorReply('That ticket category no longer exists.')));
			return;
		}
		const isStaff = cat.staffRoleIds.some((id) => interaction.member.roles.cache.has(id));
		const isAdmin = interaction.memberPermissions?.has('ManageChannels') ?? false;
		if (!isStaff && !isAdmin) {
			await interaction.followUp(r(errorReply('Only ticket staff can open a ticket for another user.')));
			return;
		}

		const targetMember = await interaction.guild.members.fetch(targetUserId).catch(() => null);
		if (!targetMember) {
			await interaction.followUp(r(errorReply('That user is no longer in the server.')));
			return;
		}

		try {
			await assertTicketOpenerAllowed(interaction.guild.id, targetUserId);
		} catch (err) {
			const botBan = await getBotBlacklistEntry(targetUserId);
			const msg = botBan.blocked
				? `**${targetMember.user.tag}** is globally blacklisted from the bot.${botBan.reason ? ` Reason: ${botBan.reason}` : ''}`
				: `**${targetMember.user.tag}** cannot have a ticket opened: ${friendlyTicketError(err)}`;
			await interaction.followUp(r(errorReply(msg)));
			return;
		}

		const alreadyOpen = !(await canOpenTicket(interaction.guild.id, targetUserId, categoryId, cat.maxOpenTickets));
		if (alreadyOpen) {
			await interaction.followUp(
				r(
					warningReply(
						`**${targetMember.user.tag}** already has the maximum number of open **${cat.label}** tickets (${cat.maxOpenTickets}).`,
					),
				),
			);
			return;
		}

		try {
			const channel = await openTicket(interaction.guild, targetMember, categoryId);
			await interaction.followUp(r(successReply(`Ticket opened for **${targetMember.user.tag}**: <#${channel.id}>`)));
		} catch (err) {
			this.container.logger.error(err);
			await interaction.followUp(r(errorReply(friendlyTicketError(err))));
		}
	}

	// ─── Claim Ticket ─────────────────────────────────────────────────────────────

	private async handleClaimRequest(interaction: ButtonInteraction<'cached'>, ticketId: number) {
		const ticket = await db
			.select()
			.from(schema.tickets)
			.where(and(eq(schema.tickets.id, ticketId), eq(schema.tickets.status, 'open')))
			.limit(1)
			.then((rs) => rs[0] ?? null);

		if (!ticket) {
			return interaction.reply(r(errorReply('This ticket is already closed or does not exist.')));
		}

		const cat = await getCategoryById(interaction.guild.id, ticket.categoryId);
		const isStaff = cat?.staffRoleIds.some((id) => interaction.member.roles.cache.has(id)) ?? false;
		const isAdmin = interaction.memberPermissions?.has('ManageChannels') ?? false;

		if (!isStaff && !isAdmin) {
			return interaction.reply(r(errorReply('Only staff can claim tickets.')));
		}

		if (ticket.claimedById) {
			if (ticket.claimedById === interaction.user.id) {
				return interaction.reply(
					r(
						warningReply(
							'You already claimed this ticket. Use **Release Claim** if you want to let someone else take it.',
						),
					),
				);
			}
			return interaction.reply(r(errorReply(`This ticket is already claimed by <@${ticket.claimedById}>.`)));
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const claimedResult = await db
			.update(schema.tickets)
			.set({ claimedById: interaction.user.id })
			.where(
				and(eq(schema.tickets.id, ticket.id), eq(schema.tickets.status, 'open'), isNull(schema.tickets.claimedById)),
			);

		if (Number((claimedResult as any)[0]?.affectedRows ?? 0) === 0) {
			return interaction.editReply(r(errorReply('This ticket was just claimed by someone else.')));
		}

		try {
			await lockTicketToClaimant(
				interaction.guild,
				ticket.channelId,
				ticket.userId,
				interaction.user.id,
				cat?.staffRoleIds ?? [],
			);
		} catch (err) {
			await db
				.update(schema.tickets)
				.set({ claimedById: null })
				.where(and(eq(schema.tickets.id, ticket.id), eq(schema.tickets.claimedById, interaction.user.id)));
			await unlockTicketStaffChat(
				interaction.guild,
				ticket.channelId,
				ticket.userId,
				interaction.user.id,
				cat?.staffRoleIds ?? [],
			).catch(() => null);
			this.container.logger.error('[tickets] Failed to lock claimed ticket permissions:', err);
			return interaction.editReply(
				r(errorReply('I could not lock this ticket to the claimant. The claim was cancelled.')),
			);
		}

		if (interaction.channel?.isTextBased() && 'setName' in interaction.channel) {
			const opener = await interaction.guild.members.fetch(ticket.userId).catch(() => null);
			const safeOpener = (opener?.user.username ?? 'user')
				.replace(/[^a-z0-9-]/gi, '')
				.toLowerCase()
				.slice(0, 20);
			await interaction.channel.setName(`claimed-${safeOpener}`).catch(() => null);
		}

		if (interaction.channel?.isTextBased() && 'send' in interaction.channel) {
			const notice = makeContainer({ color: Colors.Success });
			notice.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(`**Claimed by <@${interaction.user.id}>** — they will assist you shortly.`),
			);
			await interaction.channel.send({ components: [notice], flags: CV2_FLAG } as any).catch(() => null);
		}

		return interaction.editReply(r(successReply('You claimed this ticket.')));
	}

	private async handleUnclaimRequest(interaction: ButtonInteraction<'cached'>, ticketId: number) {
		const ticket = await db
			.select()
			.from(schema.tickets)
			.where(and(eq(schema.tickets.id, ticketId), eq(schema.tickets.status, 'open')))
			.limit(1)
			.then((rs) => rs[0] ?? null);

		if (!ticket) {
			return interaction.reply(r(errorReply('This ticket is already closed or does not exist.')));
		}

		const cat = await getCategoryById(interaction.guild.id, ticket.categoryId);
		const isStaff = cat?.staffRoleIds.some((id) => interaction.member.roles.cache.has(id)) ?? false;
		const isAdmin = interaction.memberPermissions?.has('ManageChannels') ?? false;

		if (!isStaff && !isAdmin) {
			return interaction.reply(r(errorReply('Only staff can release a claim.')));
		}

		if (!ticket.claimedById) {
			return interaction.reply(r(warningReply('This ticket is not claimed.')));
		}

		if (ticket.claimedById !== interaction.user.id && !isAdmin) {
			return interaction.reply(r(errorReply(`Only <@${ticket.claimedById}> or an admin can release this claim.`)));
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const releasedResult = await db
			.update(schema.tickets)
			.set({ claimedById: null })
			.where(
				and(
					eq(schema.tickets.id, ticket.id),
					eq(schema.tickets.status, 'open'),
					eq(schema.tickets.claimedById, ticket.claimedById),
				),
			);
		if (Number((releasedResult as any)[0]?.affectedRows ?? 0) === 0) {
			return interaction.editReply(r(errorReply('This claim changed before it could be released.')));
		}

		try {
			await unlockTicketStaffChat(
				interaction.guild,
				ticket.channelId,
				ticket.userId,
				ticket.claimedById,
				cat?.staffRoleIds ?? [],
			);
		} catch (err) {
			await db
				.update(schema.tickets)
				.set({ claimedById: ticket.claimedById })
				.where(and(eq(schema.tickets.id, ticket.id), isNull(schema.tickets.claimedById)));
			await lockTicketToClaimant(
				interaction.guild,
				ticket.channelId,
				ticket.userId,
				ticket.claimedById,
				cat?.staffRoleIds ?? [],
			).catch(() => null);
			this.container.logger.error('[tickets] Failed to restore staff ticket permissions:', err);
			return interaction.editReply(
				r(errorReply('I could not restore staff chat access, so the claim remains active.')),
			);
		}

		if (interaction.channel?.isTextBased() && 'send' in interaction.channel) {
			const notice = makeContainer({ color: Colors.Neutral });
			notice.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`**Claim released** by <@${interaction.user.id}>. Another staff member can claim this ticket.`,
				),
			);
			await interaction.channel.send({ components: [notice], flags: CV2_FLAG } as any).catch(() => null);
		}

		return interaction.editReply(r(successReply('Claim released. Another staff member can claim this ticket.')));
	}
}
