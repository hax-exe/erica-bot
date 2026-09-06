import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
	ActionRowBuilder,
	type Attachment,
	AttachmentBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChannelType,
	CheckboxBuilder,
	CheckboxGroupBuilder,
	CheckboxGroupOptionBuilder,
	type ContainerBuilder,
	FileUploadBuilder,
	type Guild,
	type GuildMember,
	LabelBuilder,
	type Message,
	ModalBuilder,
	type ModalSubmitInteraction,
	PermissionFlagsBits,
	StringSelectMenuBuilder,
	StringSelectMenuOptionBuilder,
	type TextChannel,
	TextDisplayBuilder,
	TextInputBuilder,
	TextInputStyle,
	TimestampStyles,
	time,
	userMention,
} from 'discord.js';
import { and, count, eq } from 'drizzle-orm';
import { formatBlacklistDenial, getBotBlacklistEntry } from './BlacklistUtil.js';
import { Colors, CV2_FLAG, logContainer, makeContainer, separator } from './components.js';
import { db, schema } from './database.js';
import { logFields, sendTicketFile, sendTicketLog } from './LoggingUtil.js';
import { buildReviewRequestDM, getReviewSettings } from './ReviewUtil.js';
import { scheduleTicketStatsChannelUpdate } from './TicketStatsChannelUtil.js';
import {
	getCategoryByIdFromConfig,
	getGuildCategoriesFromConfig,
	getTicketSettingsFromConfig,
	type TicketCategoryData,
	type TicketQuestion,
	type TicketSettings,
} from './TicketsConfig.js';
import { buildHtmlTranscript, buildTextTranscript } from './TicketTranscript.js';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type { TicketCategoryData, TicketQuestion, TicketSettings };
/** @deprecated Prefer TicketSettings — kept for call-site compatibility. */
export type TicketSettingsRow = TicketSettings;
export type TicketAnswers = Record<string, string>;

export type TicketFormResult = {
	answers: TicketAnswers;
	attachments: Attachment[];
};

// ─── Config getters (YAML) ─────────────────────────────────────────────────────

/** Get ticket panel settings for a guild. Returns null if not configured / wrong guild. */
export async function getTicketSettings(guildId: string): Promise<TicketSettings | null> {
	return getTicketSettingsFromConfig(guildId);
}

/** Get all ticket categories for a guild, ordered by sortOrder. */
export async function getGuildCategories(guildId: string): Promise<TicketCategoryData[]> {
	return getGuildCategoriesFromConfig(guildId);
}

/** Get a single category by slug for a guild. */
export async function getCategoryById(guildId: string, categoryId: string): Promise<TicketCategoryData | null> {
	return getCategoryByIdFromConfig(guildId, categoryId);
}

// ─── Custom IDs ────────────────────────────────────────────────────────────────

export const TICKET_SELECT_ID = 'ticket:select';
export const TICKET_MODAL_PREFIX = 'ticket:modal:';
export const TICKET_CLOSE_ID = 'ticket:close';
export const TICKET_CLOSE_CONFIRM_ID = 'ticket:close:confirm';
export const TICKET_CLOSE_CANCEL_ID = 'ticket:close:cancel';
export const TICKET_DELETE_ID = 'ticket:delete';
export const TICKET_DELETE_CONFIRM_ID = 'ticket:delete:confirm';
export const TICKET_DELETE_CANCEL_ID = 'ticket:delete:cancel';
export const TICKET_REOPEN_ID = 'ticket:reopen';
export const TICKET_REOPEN_CONFIRM_ID = 'ticket:reopen:confirm';
export const TICKET_REOPEN_CANCEL_ID = 'ticket:reopen:cancel';

/** Discord attachment limit for webhook/DM uploads (leave headroom under 25 MiB). */
const TRANSCRIPT_UPLOAD_LIMIT = 24 * 1024 * 1024;

/** Map thrown errors to short, user-friendly ticket messages. Logs stay detailed. */
export function friendlyTicketError(err: unknown): string {
	const msg = err instanceof Error ? err.message : String(err);
	if (/maximum|already have|max open/i.test(msg)) return msg;
	if (/channel (was deleted|no longer exists|not found)/i.test(msg)) {
		return 'This ticket channel no longer exists, so it cannot be reopened.';
	}
	if (/not found|no longer exists/i.test(msg))
		return 'That ticket category is no longer available. Ask staff to update the panel.';
	if (/Missing Permissions|Missing Access|50013|50001/i.test(msg)) {
		return "I don't have permission to create channels here. Please ping staff.";
	}
	if (/already closed/i.test(msg)) return 'This ticket is already closed.';
	if (/already open/i.test(msg)) return 'This ticket is already open.';
	return 'Something went wrong with that ticket action. Please try again or ping staff.';
}

/** Modal custom ID for a given category and panel message. */
export function modalId(categoryId: string, panelMessageId: string): string {
	return `${TICKET_MODAL_PREFIX}${categoryId}:${panelMessageId}`;
}

// ─── Panel posting ─────────────────────────────────────────────────────────────

/** Build the panel message payload (container + select menu) without sending it. */
export function buildPanelPayload(
	settings: TicketSettingsRow,
	categories: TicketCategoryData[],
): { components: ContainerBuilder[]; flags: number } {
	const container = makeContainer({ color: settings.panelColor, header: settings.panelTitle.replace(/\\+n/g, '\n') });
	container.addTextDisplayComponents(
		new TextDisplayBuilder().setContent(settings.panelDescription.replace(/\\+n/g, '\n')),
	);
	container.addSeparatorComponents(separator());

	const menu = new StringSelectMenuBuilder()
		.setCustomId(TICKET_SELECT_ID)
		.setPlaceholder('Select a category to open a ticket...')
		.addOptions(
			categories.map((cat) =>
				new StringSelectMenuOptionBuilder()
					.setValue(cat.categoryId)
					.setLabel(cat.label)
					.setDescription(cat.description ?? cat.label)
					.setEmoji(cat.emoji ?? '🎫'),
			),
		);

	container.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu));

	return { components: [container], flags: CV2_FLAG };
}

/** Post the ticket selection panel to the configured channel. */
export async function postTicketPanel(guild: Guild): Promise<void> {
	const settings = await getTicketSettings(guild.id);
	if (!settings?.panelChannelId) {
		throw new Error(
			'Ticket panel not configured for this server. Edit `config/tickets.yml` then run `/ticket reload`.',
		);
	}

	const categories = await getGuildCategories(guild.id);
	if (categories.length === 0) {
		throw new Error('No ticket categories in `config/tickets.yml`. Add at least one category, then `/ticket reload`.');
	}

	const ch = guild.channels.cache.get(settings.panelChannelId) as TextChannel | undefined;
	if (!ch?.isTextBased()) throw new Error(`Panel channel \`${settings.panelChannelId}\` not found.`);

	await ch.send(buildPanelPayload(settings, categories));
}

// ─── Modal builders ────────────────────────────────────────────────────────────

function buildQuestionLabel(q: TicketQuestion): LabelBuilder {
	const label = new LabelBuilder().setLabel(q.label);
	if (q.description) label.setDescription(q.description);

	switch (q.type) {
		case 'text': {
			const input = new TextInputBuilder()
				.setCustomId(q.id)
				.setStyle(q.style === 'short' ? TextInputStyle.Short : TextInputStyle.Paragraph)
				.setRequired(q.required);
			if (q.placeholder) input.setPlaceholder(q.placeholder);
			if (q.minLength !== undefined) input.setMinLength(q.minLength);
			if (q.maxLength !== undefined) input.setMaxLength(q.maxLength);
			label.setTextInputComponent(input);
			break;
		}
		case 'select': {
			const menu = new StringSelectMenuBuilder().setCustomId(q.id).setRequired(q.required);
			if (q.placeholder) menu.setPlaceholder(q.placeholder);
			if (q.minValues !== undefined) menu.setMinValues(q.minValues);
			if (q.maxValues !== undefined) menu.setMaxValues(q.maxValues);
			menu.addOptions(
				q.options.map((opt) => {
					const o = new StringSelectMenuOptionBuilder().setLabel(opt.label).setValue(opt.value);
					if (opt.description) o.setDescription(opt.description);
					if (opt.emoji) o.setEmoji(opt.emoji);
					if (opt.default) o.setDefault(true);
					return o;
				}),
			);
			label.setStringSelectMenuComponent(menu);
			break;
		}
		case 'file': {
			const upload = new FileUploadBuilder().setCustomId(q.id).setRequired(q.required);
			if (q.minValues !== undefined) upload.setMinValues(q.minValues);
			if (q.maxValues !== undefined) upload.setMaxValues(q.maxValues);
			label.setFileUploadComponent(upload);
			break;
		}
		case 'checkbox': {
			const box = new CheckboxBuilder().setCustomId(q.id);
			if (q.default !== undefined) box.setDefault(q.default);
			label.setCheckboxComponent(box);
			break;
		}
		case 'checkboxGroup': {
			const group = new CheckboxGroupBuilder().setCustomId(q.id).setRequired(q.required);
			if (q.minValues !== undefined) group.setMinValues(q.minValues);
			if (q.maxValues !== undefined) group.setMaxValues(q.maxValues);
			group.addOptions(
				q.options.map((opt) => {
					const o = new CheckboxGroupOptionBuilder().setLabel(opt.label).setValue(opt.value);
					if (opt.description) o.setDescription(opt.description);
					if (opt.default) o.setDefault(true);
					return o;
				}),
			);
			label.setCheckboxGroupComponent(group);
			break;
		}
	}

	return label;
}

/** Build a Label-based ticket questionnaire modal. */
export function buildTicketModal(cat: TicketCategoryData, customId: string): ModalBuilder {
	const modal = new ModalBuilder()
		.setCustomId(customId)
		.setTitle(`${cat.emoji ? `${cat.emoji} ` : ''}${cat.label}`.slice(0, 45));

	for (const q of cat.questions) {
		modal.addLabelComponents(buildQuestionLabel(q));
	}
	return modal;
}

function optionLabels(
	q: Extract<TicketQuestion, { type: 'select' | 'checkboxGroup' }>,
	values: readonly string[],
): string {
	const map = new Map(q.options.map((o) => [o.value, o.label]));
	return values.map((v) => map.get(v) ?? v).join(', ');
}

/** Collect answers + uploaded files from a ticket modal submit. */
export function collectTicketForm(interaction: ModalSubmitInteraction, questions: TicketQuestion[]): TicketFormResult {
	const answers: TicketAnswers = {};
	const attachments: Attachment[] = [];

	for (const q of questions) {
		switch (q.type) {
			case 'text': {
				const value = interaction.fields.getTextInputValue(q.id);
				if (value) answers[q.id] = value;
				break;
			}
			case 'select': {
				const values = interaction.fields.getStringSelectValues(q.id);
				if (values.length > 0) answers[q.id] = optionLabels(q, values);
				break;
			}
			case 'file': {
				const files = interaction.fields.getUploadedFiles(q.id, false);
				if (files && files.size > 0) {
					for (const file of files.values()) attachments.push(file);
					answers[q.id] = `${files.size} file${files.size === 1 ? '' : 's'} attached`;
				}
				break;
			}
			case 'checkbox': {
				answers[q.id] = interaction.fields.getCheckbox(q.id) ? 'Yes' : 'No';
				break;
			}
			case 'checkboxGroup': {
				const values = interaction.fields.getCheckboxGroup(q.id);
				if (values.length > 0) answers[q.id] = optionLabels(q, values);
				break;
			}
		}
	}

	return { answers, attachments };
}

// ─── Ticket queries ────────────────────────────────────────────────────────────

/** Count how many open tickets the user currently has in this category. */
export async function countOpenTickets(guildId: string, userId: string, categoryId: string): Promise<number> {
	const row = await db
		.select({ value: count() })
		.from(schema.tickets)
		.where(
			and(
				eq(schema.tickets.guildId, guildId),
				eq(schema.tickets.userId, userId),
				eq(schema.tickets.categoryId, categoryId),
				eq(schema.tickets.status, 'open'),
			),
		)
		.limit(1)
		.then((rows) => rows[0]);
	return row?.value ?? 0;
}

/** Check if the user already has an open ticket for this category (legacy max=1 helper). */
export async function hasOpenTicket(guildId: string, userId: string, categoryId: string): Promise<boolean> {
	return (await countOpenTickets(guildId, userId, categoryId)) > 0;
}

/** Whether the user may open another ticket in this category given maxOpenTickets. */
export async function canOpenTicket(
	guildId: string,
	userId: string,
	categoryId: string,
	maxOpenTickets: number,
): Promise<boolean> {
	const open = await countOpenTickets(guildId, userId, categoryId);
	return open < Math.max(1, maxOpenTickets);
}

/**
 * Throws if the user is bot-blacklisted or support-blacklisted in this guild.
 * Used by open/reopen so no interaction path can bypass blacklist checks.
 */
export async function assertTicketOpenerAllowed(guildId: string, userId: string): Promise<void> {
	const botBan = await getBotBlacklistEntry(userId);
	if (botBan.blocked) {
		throw new Error(formatBlacklistDenial(botBan.reason));
	}

	const supportBanned = await db
		.select()
		.from(schema.supportBlacklist)
		.where(and(eq(schema.supportBlacklist.guildId, guildId), eq(schema.supportBlacklist.userId, userId)))
		.limit(1)
		.then((r) => r[0] ?? null);

	if (supportBanned) {
		const reason =
			supportBanned.reason && supportBanned.reason !== 'No reason provided' ? ` Reason: ${supportBanned.reason}` : '';
		throw new Error(`You are blacklisted from opening support tickets.${reason}`);
	}
}

// ─── Ticket creation ───────────────────────────────────────────────────────────

function normalizeTicketForm(form: TicketFormResult | TicketAnswers = {}): TicketFormResult {
	if (form && typeof form === 'object' && 'answers' in form) {
		return {
			answers: (form as TicketFormResult).answers ?? {},
			attachments: (form as TicketFormResult).attachments ?? [],
		};
	}
	return { answers: (form as TicketAnswers) ?? {}, attachments: [] };
}

/** Create a text channel under the configured Discord category and save a DB record. Returns the new channel. */
export async function openTicket(
	guild: Guild,
	member: GuildMember,
	categoryId: string,
	form: TicketFormResult | TicketAnswers = {},
): Promise<TextChannel> {
	await assertTicketOpenerAllowed(guild.id, member.id);

	const { answers, attachments } = normalizeTicketForm(form);

	const [settings, cat] = await Promise.all([getTicketSettings(guild.id), getCategoryById(guild.id, categoryId)]);

	if (!cat) throw new Error(`Ticket category \`${categoryId}\` not found.`);

	const openCount = await countOpenTickets(guild.id, member.id, categoryId);
	if (openCount >= Math.max(1, cat.maxOpenTickets)) {
		throw new Error(
			`You already have ${openCount} open **${cat.label}** ticket${openCount === 1 ? '' : 's'} (max ${cat.maxOpenTickets}).`,
		);
	}

	const safeName =
		member.user.username
			.replace(/[^a-z0-9-]/gi, '')
			.toLowerCase()
			.slice(0, 20) || 'user';

	const safeCategory = cat.label
		.replace(/[^a-z0-9-]/gi, '')
		.toLowerCase()
		.slice(0, 20);

	let template = cat.nameTemplate;
	if (!template.includes('{category}')) {
		template = '{category}-{username}';
	}

	const channelName = template
		.replace('{category}', safeCategory)
		.replace('{username}', safeName)
		.replace('{id}', member.id)
		.slice(0, 100);

	// Build permission overwrites — deny @everyone, allow opener + staff roles
	const permissionOverwrites = [
		{
			id: guild.roles.everyone.id,
			deny: [PermissionFlagsBits.ViewChannel],
		},
		{
			id: member.id,
			allow: [
				PermissionFlagsBits.ViewChannel,
				PermissionFlagsBits.SendMessages,
				PermissionFlagsBits.ReadMessageHistory,
				PermissionFlagsBits.AttachFiles,
				PermissionFlagsBits.EmbedLinks,
				PermissionFlagsBits.AddReactions,
			],
		},
		...cat.staffRoleIds.map((roleId) => ({
			id: roleId,
			allow: [
				PermissionFlagsBits.ViewChannel,
				PermissionFlagsBits.SendMessages,
				PermissionFlagsBits.ReadMessageHistory,
				PermissionFlagsBits.AttachFiles,
				PermissionFlagsBits.EmbedLinks,
				PermissionFlagsBits.AddReactions,
				PermissionFlagsBits.ManageMessages,
			],
		})),
	];

	// Create a text channel inside the configured Discord category (or at root if not set)
	const channel = (await guild.channels.create({
		name: channelName,
		type: ChannelType.GuildText,
		parent: cat.discordCategoryId ?? null,
		permissionOverwrites,
		reason: `Ticket opened by ${member.user.tag} — Category: ${cat.label}`,
	})) as TextChannel;

	// Save to DB — if this fails, delete the orphan channel so it doesn't linger
	let ticket: typeof schema.tickets.$inferSelect;
	try {
		const [idRow] = await db
			.insert(schema.tickets)
			.values({
				guildId: guild.id,
				userId: member.id,
				channelId: channel.id,
				categoryId,
				status: 'open',
			})
			.$returningId();
		const [inserted] = await db.select().from(schema.tickets).where(eq(schema.tickets.id, idRow.id)).limit(1);
		ticket = inserted!;
	} catch (err) {
		await channel.delete('Ticket DB insert failed — cleaning up orphan channel').catch(() => null);
		throw err;
	}

	// Build opening message — mention staff roles so they get notified
	const catColor = cat.color ?? Colors.Ticket;
	const staffMentions = cat.staffRoleIds.map((id) => `<@&${id}>`).join(' ');
	const openContainer = makeContainer({ color: catColor, header: `${cat.label} Ticket` });

	const openText = `${userMention(member.id)}${staffMentions ? ` ${staffMentions}` : ''}\n\n${cat.openMessage.replace(/\\+n/g, '\n')}`;
	openContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(openText));

	// Append questionnaire answers if any
	if (cat.questions.length > 0 && Object.keys(answers).length > 0) {
		openContainer.addSeparatorComponents(separator());
		const answerLines = cat.questions
			.filter((q) => answers[q.id])
			.map((q) => `**${q.label}**\n${answers[q.id]}`)
			.join('\n\n');
		if (answerLines) {
			openContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(answerLines));
		}
	}

	openContainer.addSeparatorComponents(separator());
	openContainer.addTextDisplayComponents(
		new TextDisplayBuilder().setContent(
			"**What to do next**\nDescribe your issue below and wait for staff to claim this ticket. You or staff can close it when you're done. Inactive tickets may auto-close after a few days.",
		),
	);
	openContainer.addSeparatorComponents(separator());
	openContainer.addTextDisplayComponents(
		new TextDisplayBuilder().setContent(
			`-# Ticket ID: \`${ticket.id}\` • Opened ${time(Math.floor(Date.now() / 1000), TimestampStyles.ShortDateTime)}`,
		),
	);
	openContainer.addSeparatorComponents(separator());
	openContainer.addActionRowComponents(
		new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId(`ticket:claim:${ticket.id}`).setLabel('Claim').setStyle(ButtonStyle.Success),
			new ButtonBuilder()
				.setCustomId(`ticket:unclaim:${ticket.id}`)
				.setLabel('Release')
				.setStyle(ButtonStyle.Secondary),
			new ButtonBuilder().setCustomId(`${TICKET_CLOSE_ID}:${ticket.id}`).setLabel('Close').setStyle(ButtonStyle.Danger),
		),
	);

	await channel.send({ components: [openContainer], flags: CV2_FLAG });

	// Re-post modal file uploads into the ticket channel for staff
	if (attachments.length > 0) {
		const files = attachments.map((a) => new AttachmentBuilder(a.url, { name: a.name ?? `upload-${a.id}` }));
		await channel
			.send({
				content: `📎 **Attachments from ${userMention(member.id)}**`,
				files,
			})
			.catch(() => null);
	}

	// DM the user if configured
	if (settings?.dmOnOpen) {
		const dm = makeContainer({ color: catColor, header: 'Ticket Opened' });
		dm.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`Your support ticket has been opened in **${guild.name}**.\nCategory: **${cat.label}**\nChannel: <#${channel.id}>`,
			),
		);
		await member.send({ components: [dm], flags: CV2_FLAG }).catch(() => null);
	}

	// Log to ticket log webhook
	const log = logContainer({
		title: 'Ticket Opened',
		color: Colors.Ticket,
		fields: [
			logFields.user(member.id),
			logFields.category(cat.label),
			logFields.channel(channel.id),
			logFields.ticketId(ticket.id),
		],
		timestamp: true,
		targetUser: member.user,
	});

	await sendTicketLog(guild, log);
	scheduleTicketStatsChannelUpdate(guild);

	return channel;
}

// ─── Transcript helpers ────────────────────────────────────────────────────────

/** Fetch all messages from a channel by paginating in 100-message chunks. */
async function fetchAllMessages(channel: TextChannel): Promise<Message[]> {
	const all = new Map<string, Message>();
	let before: string | undefined;

	// eslint-disable-next-line no-constant-condition
	while (true) {
		const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
		if (!batch || batch.size === 0) break;
		for (const [id, msg] of batch) all.set(id, msg);
		before = batch.last()?.id;
		if (batch.size < 100) break;
	}

	return [...all.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

// ─── Ticket close ──────────────────────────────────────────────────────────────

/** Close an open ticket by its DB ID. Generates transcripts and archives the channel. */
export async function closeTicket(
	guild: Guild,
	ticketId: number,
	closedBy: GuildMember | import('discord.js').User,
): Promise<void> {
	const ticket = await db
		.select()
		.from(schema.tickets)
		.where(and(eq(schema.tickets.id, ticketId), eq(schema.tickets.status, 'open')))
		.limit(1)
		.then((r) => r[0] ?? null);

	if (!ticket) throw new Error('Ticket not found or already closed.');

	const [settings, cat] = await Promise.all([
		getTicketSettings(guild.id),
		getCategoryById(guild.id, ticket.categoryId),
	]);

	const transcriptCode = crypto.randomBytes(16).toString('hex');
	const channel = guild.channels.cache.get(ticket.channelId) as TextChannel | undefined;
	if (!channel) throw new Error('Ticket channel not found; the ticket was left open.');

	const messages = await fetchAllMessages(channel);
	const messagesCount = messages.filter((m) => !m.author.bot).length;

	const openerUser = await guild.client.users.fetch(ticket.userId).catch(() => null);
	const htmlTranscript = buildHtmlTranscript(
		guild,
		{
			ticketId,
			guildName: guild.name,
			categoryLabel: cat?.label ?? ticket.categoryId,
			openerTag: openerUser?.tag ?? ticket.userId,
			openerId: ticket.userId,
			closedByTag: 'tag' in closedBy ? closedBy.tag : closedBy.user.tag,
			closedById: closedBy.id,
			channelName: channel.name,
		},
		messages,
	);
	const textTranscript = buildTextTranscript(messages);

	const transcriptsDir = path.join(process.cwd(), 'data', 'transcripts');
	if (!fs.existsSync(transcriptsDir)) fs.mkdirSync(transcriptsDir, { recursive: true });
	const htmlPath = path.join(transcriptsDir, `${transcriptCode}.html`);
	const textPath = path.join(transcriptsDir, `${transcriptCode}.txt`);
	fs.writeFileSync(htmlPath, htmlTranscript);
	fs.writeFileSync(textPath, textTranscript);

	// Atomically claim the close only after its transcript is safely on disk.
	const closedResult = await db
		.update(schema.tickets)
		.set({ status: 'closed', closedAt: new Date(), closedById: closedBy.id, transcriptCode })
		.where(and(eq(schema.tickets.id, ticketId), eq(schema.tickets.status, 'open')));
	const closedAffected = Number((closedResult as any)[0]?.affectedRows ?? 0);

	if (closedAffected === 0) {
		fs.unlinkSync(htmlPath);
		fs.unlinkSync(textPath);
		throw new Error('Ticket not found or already closed.');
	}

	const uploadFiles: { attachment: Buffer; name: string }[] = [
		{ attachment: htmlTranscript, name: `transcript-${ticketId}.html` },
	];
	if (htmlTranscript.byteLength + textTranscript.byteLength <= TRANSCRIPT_UPLOAD_LIMIT) {
		uploadFiles.push({ attachment: textTranscript, name: `transcript-${ticketId}.txt` });
	}

	// DM the owner if configured
	if (settings?.dmOnClose && ticket.userId) {
		const owner = await guild.members.fetch(ticket.userId).catch(() => null);
		if (owner) {
			const dmContainer = makeContainer({ color: Colors.Neutral, header: 'Ticket Closed' });
			dmContainer.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`Your ticket in **${guild.name}** (Category: **${cat?.label ?? ticket.categoryId}**) has been closed by ${userMention(closedBy.id)}.`,
				),
			);
			await owner.send({ components: [dmContainer], flags: CV2_FLAG }).catch(() => null);
			await owner.send({ files: uploadFiles }).catch(() => null);
		}
	}

	// Log to ticket log webhook
	const log = logContainer({
		title: 'Ticket Closed',
		color: Colors.Neutral,
		fields: [
			logFields.ticketId(ticketId),
			logFields.category(cat?.label ?? ticket.categoryId),
			logFields.openedBy(ticket.userId),
			logFields.closedBy(closedBy.id),
			{ name: 'Messages', value: `${messagesCount}` },
		],
		timestamp: true,
	});

	await sendTicketLog(guild, log);
	await sendTicketFile(guild, `Transcript for ticket #${ticketId}`, uploadFiles);

	// Send review DM to the ticket owner if reviews are enabled
	const reviewSettings = await getReviewSettings(guild.id);
	if (reviewSettings?.enabled && ticket.userId) {
		const ownerUser = await guild.client.users.fetch(ticket.userId).catch(() => null);
		if (ownerUser) {
			const reviewDM = buildReviewRequestDM(ticketId, cat?.label ?? ticket.categoryId, guild.name, guild.id);
			await ownerUser.send(reviewDM as any).catch(() => null);
		}
	}

	// Send a closing notice then delete or archive the channel
	if (channel) {
		const closedCatId = settings?.closedCategoryId;
		if (closedCatId) {
			const closeMsg = makeContainer({ color: Colors.Neutral });
			closeMsg.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`**This ticket has been closed by ${userMention(closedBy.id)}.**\nIt has been moved to the archive category.`,
				),
			);
			closeMsg.addSeparatorComponents(separator());
			closeMsg.addActionRowComponents(
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
			await channel.send({ components: [closeMsg], flags: CV2_FLAG }).catch(() => null);

			// Edit opener permissions to deny sending messages
			if (ticket.userId) {
				await channel.permissionOverwrites
					.edit(ticket.userId, {
						SendMessages: false,
						AddReactions: false,
					})
					.catch(() => null);
			}

			// Move to closed category
			await channel.setParent(closedCatId, { lockPermissions: false }).catch(() => null);
		} else {
			const closeMsg = makeContainer({ color: Colors.Error });
			closeMsg.addTextDisplayComponents(
				new TextDisplayBuilder().setContent('This ticket has been closed. This channel will be deleted shortly.'),
			);
			await channel.send({ components: [closeMsg], flags: CV2_FLAG }).catch(() => null);
			// Brief pause so the user can see the closing message
			await new Promise<void>((res) => setTimeout(res, 3000));
			await channel.delete('Ticket closed').catch(() => null);
		}
	}

	scheduleTicketStatsChannelUpdate(guild);
}

// ─── Ticket reopen (archived channel must still exist) ─────────────────────────

/** Reopen a closed ticket whose Discord channel still exists. */
export async function reopenTicket(
	guild: Guild,
	ticketId: number,
	reopenedBy: GuildMember | import('discord.js').User,
): Promise<void> {
	const ticket = await db
		.select()
		.from(schema.tickets)
		.where(and(eq(schema.tickets.id, ticketId), eq(schema.tickets.status, 'closed')))
		.limit(1)
		.then((r) => r[0] ?? null);

	if (!ticket) throw new Error('Ticket not found or already open.');

	// Owner must still be allowed to hold an open ticket (bot + support blacklist).
	await assertTicketOpenerAllowed(guild.id, ticket.userId);

	const cat = await getCategoryById(guild.id, ticket.categoryId);
	if (!cat) throw new Error('That ticket category no longer exists.');

	const mayOpen = await canOpenTicket(guild.id, ticket.userId, ticket.categoryId, cat.maxOpenTickets);
	if (!mayOpen) {
		throw new Error(
			`The ticket opener already has the maximum number of open **${cat.label}** tickets (${cat.maxOpenTickets}).`,
		);
	}

	const channel = await guild.channels.fetch(ticket.channelId).catch(() => null);
	if (!channel || !channel.isTextBased() || channel.isDMBased() || !('permissionOverwrites' in channel)) {
		throw new Error('Ticket channel was deleted or no longer exists.');
	}

	if (cat.discordCategoryId) {
		await channel.setParent(cat.discordCategoryId, { lockPermissions: false });
	}

	await channel.permissionOverwrites
		.edit(ticket.userId, {
			ViewChannel: true,
			SendMessages: true,
			ReadMessageHistory: true,
			AttachFiles: true,
			EmbedLinks: true,
			AddReactions: true,
		})
		.catch(() => null);

	const reopenedResult = await db
		.update(schema.tickets)
		.set({
			status: 'open',
			closedAt: null,
			closedById: null,
			claimedById: null,
			inactivityWarningSent: false,
			lastActivityAt: new Date(),
		})
		.where(and(eq(schema.tickets.id, ticketId), eq(schema.tickets.status, 'closed')));
	const reopenedAffected = Number((reopenedResult as any)[0]?.affectedRows ?? 0);

	if (reopenedAffected === 0) throw new Error('Ticket not found or already open.');

	const notice = makeContainer({ color: Colors.Success, header: 'Ticket Reopened' });
	notice.addTextDisplayComponents(
		new TextDisplayBuilder().setContent(
			`This ticket was reopened by ${userMention(reopenedBy.id)}. You can continue the conversation here.`,
		),
	);
	await channel.send({ components: [notice], flags: CV2_FLAG }).catch(() => null);

	const log = logContainer({
		title: 'Ticket Reopened',
		color: Colors.Success,
		fields: [
			logFields.ticketId(ticketId),
			logFields.category(cat.label),
			logFields.openedBy(ticket.userId),
			{ name: 'Reopened by', value: userMention(reopenedBy.id) },
		],
		timestamp: true,
	});
	await sendTicketLog(guild, log);
	scheduleTicketStatsChannelUpdate(guild);
}
