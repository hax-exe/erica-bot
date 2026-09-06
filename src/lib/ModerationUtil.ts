import { randomBytes } from 'node:crypto';
import { container } from '@sapphire/framework';
import {
	ActionRowBuilder,
	AttachmentBuilder,
	ButtonBuilder,
	ButtonStyle,
	type Client,
	type Guild,
	GuildMember,
	TextDisplayBuilder,
	TimestampStyles,
	time,
	type User,
} from 'discord.js';
import { and, count, desc, eq, gt } from 'drizzle-orm';
import type { InfractionType } from '../db/schema.js';
import { Colors, CV2_FLAG, logContainer, makeContainer } from './components.js';
import { db, schema } from './database.js';
import { logFields, sendModLog } from './LoggingUtil.js';
import { humanDuration } from './parseDuration.js';

// ─── Timeout Bypass ─────────────────────────────────────────────────────────────

export const pendingTimeoutBypass = new Set<string>();

export function bypassTimeoutUpdate(userId: string) {
	pendingTimeoutBypass.add(userId);
	setTimeout(() => {
		pendingTimeoutBypass.delete(userId);
	}, 5000);
}

// Monkey-patch GuildMember.prototype.timeout to automatically flag bot-initiated timeouts for event bypass
const originalTimeout = GuildMember.prototype.timeout;
GuildMember.prototype.timeout = function (
	this: GuildMember,
	communicationDisabledUntil: number | null,
	reason?: string,
) {
	bypassTimeoutUpdate(this.id);
	return originalTimeout.call(this, communicationDisabledUntil, reason);
};

// ─── Case IDs ──────────────────────────────────────────────────────────────────

const CASE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const CASE_ID_LENGTH = 7;

/** Generate a short random case ID like `JVDuXXa`. */
function generateCaseId(): string {
	const bytes = randomBytes(CASE_ID_LENGTH);
	return Array.from(bytes, (b) => CASE_ALPHABET[b % CASE_ALPHABET.length]).join('');
}

// ─── Hierarchy check ───────────────────────────────────────────────────────────

/**
 * Ensures the executing moderator outranks the target.
 * Guild owners bypass all checks. Returns an error reason if blocked.
 */
export function checkHierarchy(
	moderator: GuildMember,
	target: GuildMember,
): { ok: true } | { ok: false; reason: string } {
	if (moderator.id === moderator.guild.ownerId) return { ok: true };
	if (target.id === target.guild.ownerId) {
		return { ok: false, reason: 'You cannot take action against the server owner.' };
	}
	if (target.roles.highest.comparePositionTo(moderator.roles.highest) >= 0) {
		return { ok: false, reason: 'You cannot take action against a member with an equal or higher role.' };
	}
	const me = target.guild.members.me;
	if (me && target.roles.highest.comparePositionTo(me.roles.highest) >= 0) {
		return { ok: false, reason: 'I do not have a high enough role to moderate this member.' };
	}
	return { ok: true };
}

// ─── Infraction creation ───────────────────────────────────────────────────────

export interface CreateInfractionOptions {
	guildId: string;
	userId: string;
	moderatorId: string;
	type: InfractionType;
	reason: string;
	duration?: number; // milliseconds
	proofUrl?: string | null;
	linkedCaseId?: string | null;
}

export async function createInfraction(opts: CreateInfractionOptions) {
	let autoLinkedCaseId: string | null = opts.linkedCaseId ?? null;
	if (!autoLinkedCaseId) {
		if (opts.type === 'unban') {
			const candidateBans = await db
				.select()
				.from(schema.infractions)
				.where(
					and(
						eq(schema.infractions.guildId, opts.guildId),
						eq(schema.infractions.userId, opts.userId),
						eq(schema.infractions.type, 'ban'),
					),
				)
				.orderBy(desc(schema.infractions.createdAt));

			for (const candidate of candidateBans) {
				const [existingLink] = await db
					.select()
					.from(schema.infractions)
					.where(eq(schema.infractions.linkedCaseId, candidate.caseId))
					.limit(1);
				if (!existingLink) {
					autoLinkedCaseId = candidate.caseId;
					break;
				}
			}
		} else if (opts.type === 'untimeout') {
			const candidateTimeouts = await db
				.select()
				.from(schema.infractions)
				.where(
					and(
						eq(schema.infractions.guildId, opts.guildId),
						eq(schema.infractions.userId, opts.userId),
						eq(schema.infractions.type, 'timeout'),
					),
				)
				.orderBy(desc(schema.infractions.createdAt));

			for (const candidate of candidateTimeouts) {
				const [existingLink] = await db
					.select()
					.from(schema.infractions)
					.where(eq(schema.infractions.linkedCaseId, candidate.caseId))
					.limit(1);
				if (!existingLink) {
					autoLinkedCaseId = candidate.caseId;
					break;
				}
			}
		}
	}

	// Retry on the rare chance of a case ID collision (UNIQUE constraint on caseId)
	for (let attempt = 0; attempt < 5; attempt++) {
		const caseId = generateCaseId();
		try {
			const [idRow] = await db
				.insert(schema.infractions)
				.values({
					guildId: opts.guildId,
					userId: opts.userId,
					moderatorId: opts.moderatorId,
					type: opts.type,
					reason: opts.reason,
					duration: opts.duration,
					caseId,
					proofUrl: opts.proofUrl,
					linkedCaseId: autoLinkedCaseId,
				})
				.$returningId();
			const [infraction] = await db
				.select()
				.from(schema.infractions)
				.where(eq(schema.infractions.id, idRow.id))
				.limit(1);
			container.logger.info(
				`[Moderation] Created infraction [Case: ${caseId}] for ${opts.userId} (Type: ${opts.type})`,
			);
			if ((opts.type === 'timeout' || opts.type === 'untimeout') && opts.moderatorId !== 'SYSTEM') {
				bypassTimeoutUpdate(opts.userId);
			}
			// Any untimeout case should stop the natural-expiry scheduler from double-logging
			if (opts.type === 'untimeout') {
				await db
					.update(schema.infractions)
					.set({ untimeoutLogged: true })
					.where(
						and(
							eq(schema.infractions.guildId, opts.guildId),
							eq(schema.infractions.userId, opts.userId),
							eq(schema.infractions.type, 'timeout'),
							eq(schema.infractions.untimeoutLogged, false),
						),
					);
			}
			return infraction;
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			const isDuplicate = msg.includes('UNIQUE constraint failed') || msg.includes('Duplicate entry');
			if (!isDuplicate || attempt === 4) throw err;
		}
	}
	throw new Error('[Moderation] Failed to generate unique case ID after 5 attempts');
}

// ─── Infraction queries ────────────────────────────────────────────────────────

export async function getInfractions(guildId: string, userId: string) {
	const [guildRow] = await db.select().from(schema.guilds).where(eq(schema.guilds.id, guildId)).limit(1);
	const warnDecayDays = guildRow?.warnDecayDays;

	const list = await db
		.select()
		.from(schema.infractions)
		.where(and(eq(schema.infractions.guildId, guildId), eq(schema.infractions.userId, userId)))
		.orderBy(desc(schema.infractions.createdAt));

	if (warnDecayDays && warnDecayDays > 0) {
		const decayMs = warnDecayDays * 24 * 60 * 60 * 1000;
		const now = Date.now();
		return list.map((inf) => ({
			...inf,
			isExpired: inf.type === 'warn' && now - inf.createdAt.getTime() > decayMs,
		}));
	}

	return list.map((inf) => ({ ...inf, isExpired: false }));
}

export async function getInfractionByCase(guildId: string, caseId: string) {
	return db
		.select()
		.from(schema.infractions)
		.where(and(eq(schema.infractions.guildId, guildId), eq(schema.infractions.caseId, caseId)))
		.limit(1)
		.then((r) => r[0] ?? null);
}

export async function updateInfractionReason(guildId: string, caseId: string, reason: string, editorId: string) {
	// Snapshot the original reason the first time the case is edited
	const existing = await getInfractionByCase(guildId, caseId);
	if (!existing) return null;

	const result = await db
		.update(schema.infractions)
		.set({
			reason,
			originalReason: existing.originalReason ?? existing.reason,
			editedAt: new Date(),
			editedById: editorId,
		})
		.where(and(eq(schema.infractions.guildId, guildId), eq(schema.infractions.caseId, caseId)));
	const affected = Number((result as any)[0]?.affectedRows ?? 0);
	if (affected === 0) return null;
	return getInfractionByCase(guildId, caseId);
}

// ─── Mod notes ─────────────────────────────────────────────────────────────────

export async function createNote(guildId: string, userId: string, moderatorId: string, content: string) {
	const [idRow] = await db.insert(schema.modNotes).values({ guildId, userId, moderatorId, content }).$returningId();
	const [note] = await db.select().from(schema.modNotes).where(eq(schema.modNotes.id, idRow.id)).limit(1);
	return note;
}

export async function getNotes(guildId: string, userId: string) {
	return db
		.select()
		.from(schema.modNotes)
		.where(and(eq(schema.modNotes.guildId, guildId), eq(schema.modNotes.userId, userId)))
		.orderBy(desc(schema.modNotes.createdAt));
}

export async function deleteNote(guildId: string, noteId: number) {
	const [existing] = await db
		.select()
		.from(schema.modNotes)
		.where(and(eq(schema.modNotes.guildId, guildId), eq(schema.modNotes.id, noteId)))
		.limit(1);
	if (!existing) return null;
	const result = await db
		.delete(schema.modNotes)
		.where(and(eq(schema.modNotes.guildId, guildId), eq(schema.modNotes.id, noteId)));
	const affected = Number((result as any)[0]?.affectedRows ?? 0);
	return affected > 0 ? existing : null;
}

export async function deleteInfraction(guildId: string, caseId: string) {
	return db
		.delete(schema.infractions)
		.where(and(eq(schema.infractions.guildId, guildId), eq(schema.infractions.caseId, caseId)));
}

export async function clearUserInfractions(guildId: string, userId: string, warnOnly = true) {
	const typeFilter = warnOnly ? eq(schema.infractions.type, 'warn') : undefined;
	const where = and(eq(schema.infractions.guildId, guildId), eq(schema.infractions.userId, userId), typeFilter);
	const result = await db.select({ n: count() }).from(schema.infractions).where(where);
	await db.delete(schema.infractions).where(where);
	return result[0]?.n ?? 0;
}

// ─── Mod log dispatch ──────────────────────────────────────────────────────────

const INFRACTION_COLOR: Record<string, number> = {
	ban: Colors.Error,
	unban: Colors.Success,
	kick: Colors.Moderation,
	timeout: Colors.Moderation,
	untimeout: Colors.Success,
	softban: Colors.Error,
	warn: Colors.Moderation,
};

const INFRACTION_LABEL: Record<string, string> = {
	ban: 'Ban',
	unban: 'Unban',
	kick: 'Kick',
	timeout: 'Timeout',
	untimeout: 'Untimeout',
	softban: 'Softban',
	warn: 'Warning',
};

/**
 * Post a moderation action to the guild's mod log channel.
 */
export async function dispatchModLog(options: {
	guild: Guild;
	targetUser: User;
	moderator: User;
	type: InfractionType;
	reason: string;
	duration?: number;
	caseId: string;
	proofAttachment?: import('discord.js').Attachment | null;
	linkedCaseId?: string | null;
}) {
	const { guild, targetUser, moderator, type, reason, duration, caseId, proofAttachment, linkedCaseId } = options;

	let resolvedLinkedCaseId = linkedCaseId;
	if (resolvedLinkedCaseId === undefined) {
		const infraction = await getInfractionByCase(guild.id, caseId);
		resolvedLinkedCaseId = infraction?.linkedCaseId ?? null;
	}

	const fields: Array<{ name: string; value: string }> = [];

	if (resolvedLinkedCaseId) {
		fields.push({ name: 'Linked Case', value: `\`${resolvedLinkedCaseId}\`` });
	}

	fields.push(
		logFields.user(targetUser.id),
		logFields.moderator(moderator.id),
		logFields.case(caseId),
		logFields.reason(reason),
	);

	if (duration) {
		const expiresAt = Math.floor((Date.now() + duration) / 1000);
		fields.push({
			name: 'Duration',
			value: `${time(expiresAt, TimestampStyles.RelativeTime)} · until ${time(expiresAt, TimestampStyles.ShortDateTime)}`,
		});
	}

	const embed = logContainer({
		title: INFRACTION_LABEL[type] ?? type,
		color: INFRACTION_COLOR[type],
		fields,
		timestamp: true,
		targetUser,
		executor: moderator,
	});

	const actionRows = getModActionRow(targetUser.id, type, caseId);
	embed.addActionRowComponents(...actionRows);

	const files: AttachmentBuilder[] = [];
	if (proofAttachment) {
		files.push(new AttachmentBuilder(proofAttachment.url, { name: proofAttachment.name }));
	}

	container.logger.info(`[Moderation] Dispatching mod log for ${targetUser.username} (Type: ${type}, Case: ${caseId})`);
	await sendModLog(guild, embed, files).catch(() => null);
}

// ─── Mod action row ────────────────────────────────────────────────────────────

/** Build a contextual moderation action row for a given user ID.
 *  Buttons adapt based on the infraction type so they always make sense. */
export function getModActionRow(userId: string, type?: string, _caseId?: string): ActionRowBuilder<ButtonBuilder>[] {
	const isBanned = type === 'ban' || type === 'softban';
	const isTimedOut = type === 'timeout';

	const row1Buttons: ButtonBuilder[] = [];

	if (!isBanned) {
		row1Buttons.push(
			new ButtonBuilder().setCustomId(`mod:warn:${userId}`).setLabel('Warn').setStyle(ButtonStyle.Secondary),
			new ButtonBuilder().setCustomId(`mod:kick:${userId}`).setLabel('Kick').setStyle(ButtonStyle.Secondary),
		);

		if (isTimedOut) {
			row1Buttons.push(
				new ButtonBuilder()
					.setCustomId(`mod:untimeout:${userId}`)
					.setLabel('Untimeout')
					.setStyle(ButtonStyle.Secondary),
			);
		} else {
			row1Buttons.push(
				new ButtonBuilder().setCustomId(`mod:timeout:${userId}`).setLabel('Timeout').setStyle(ButtonStyle.Secondary),
			);
		}

		row1Buttons.push(new ButtonBuilder().setCustomId(`mod:ban:${userId}`).setLabel('Ban').setStyle(ButtonStyle.Danger));
	} else {
		row1Buttons.push(
			new ButtonBuilder().setCustomId(`mod:unban:${userId}`).setLabel('Unban').setStyle(ButtonStyle.Success),
		);
	}

	const row2Buttons: ButtonBuilder[] = [
		new ButtonBuilder().setCustomId(`mod:history:${userId}`).setLabel('History').setStyle(ButtonStyle.Primary),
		new ButtonBuilder().setCustomId(`mod:note:${userId}`).setLabel('Add Note').setStyle(ButtonStyle.Secondary),
	];

	return [
		new ActionRowBuilder<ButtonBuilder>().addComponents(row1Buttons),
		new ActionRowBuilder<ButtonBuilder>().addComponents(row2Buttons),
	];
}

// ─── Warn escalation ───────────────────────────────────────────────────────────

/**
 * Count the user's current warnings in the guild, check escalation rules,
 * and apply the matching action if one exists.
 * Returns a short description of the action taken, or null if nothing fired.
 */
export async function applyWarnEscalation(
	guild: Guild,
	target: User,
	client: Client<true>,
	triggeringCaseId?: string,
): Promise<string | null> {
	const [guildRow] = await db.select().from(schema.guilds).where(eq(schema.guilds.id, guild.id)).limit(1);
	const warnDecayDays = guildRow?.warnDecayDays;

	let whereClause = and(
		eq(schema.infractions.guildId, guild.id),
		eq(schema.infractions.userId, target.id),
		eq(schema.infractions.type, 'warn'),
	);

	if (warnDecayDays && warnDecayDays > 0) {
		const activeCutoff = new Date(Date.now() - warnDecayDays * 24 * 60 * 60 * 1000);
		whereClause = and(whereClause, gt(schema.infractions.createdAt, activeCutoff));
	}

	const [{ warnCount }] = await db.select({ warnCount: count() }).from(schema.infractions).where(whereClause);

	const rule = await db.query.warnEscalation.findFirst({
		where: and(eq(schema.warnEscalation.guildId, guild.id), eq(schema.warnEscalation.threshold, warnCount)),
	});

	if (!rule) return null;

	const member = guild.members.cache.get(target.id);
	if (!member) return null;

	const reason = `Auto-escalation: ${warnCount} warning${warnCount === 1 ? '' : 's'}`;

	try {
		if (rule.action === 'timeout' && rule.durationMs) {
			// DM before timeout
			const dm = makeContainer({ color: Colors.Moderation, header: `You have been timed out in ${guild.name}` });
			dm.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(`**Reason** ${reason}\n-# Duration: **${humanDuration(rule.durationMs)}**`),
			);
			await member.send({ components: [dm], flags: CV2_FLAG }).catch(() => null);

			await member.timeout(rule.durationMs, reason);
			const esc = await createInfraction({
				guildId: guild.id,
				userId: target.id,
				moderatorId: client.user.id,
				type: 'timeout',
				reason,
				duration: rule.durationMs,
				linkedCaseId: triggeringCaseId,
			});
			await dispatchModLog({
				guild,
				targetUser: target,
				moderator: client.user,
				type: 'timeout',
				reason,
				caseId: esc.caseId,
				duration: rule.durationMs,
			});
			return `timed out for **${humanDuration(rule.durationMs)}** after reaching ${warnCount} warnings`;
		}
		if (rule.action === 'kick') {
			// DM before kick
			const dm = makeContainer({ color: Colors.Moderation, header: `You have been kicked from ${guild.name}` });
			dm.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Reason** ${reason}`));
			await member.send({ components: [dm], flags: CV2_FLAG }).catch(() => null);

			await member.kick(reason);
			const esc = await createInfraction({
				guildId: guild.id,
				userId: target.id,
				moderatorId: client.user.id,
				type: 'kick',
				reason,
				linkedCaseId: triggeringCaseId,
			});
			await dispatchModLog({
				guild,
				targetUser: target,
				moderator: client.user,
				type: 'kick',
				reason,
				caseId: esc.caseId,
			});
			return `kicked after reaching ${warnCount} warnings`;
		}
		if (rule.action === 'ban') {
			// DM before ban
			const dm = makeContainer({ color: Colors.Error, header: `You have been banned from ${guild.name}` });
			dm.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(`**Reason** ${reason}\n-# You were permanently banned.`),
			);
			await member.send({ components: [dm], flags: CV2_FLAG }).catch(() => null);

			await guild.bans.create(target.id, { reason });
			const esc = await createInfraction({
				guildId: guild.id,
				userId: target.id,
				moderatorId: client.user.id,
				type: 'ban',
				reason,
				linkedCaseId: triggeringCaseId,
			});
			await dispatchModLog({
				guild,
				targetUser: target,
				moderator: client.user,
				type: 'ban',
				reason,
				caseId: esc.caseId,
			});
			return `banned after reaching ${warnCount} warnings`;
		}
	} catch {
		// Non-fatal — member may have left or bot lacks permission
	}

	return null;
}

// ─── Autocomplete Helpers ──────────────────────────────────────────────────────

export async function handleReasonAutocomplete(interaction: import('discord.js').AutocompleteInteraction) {
	if (!interaction.inCachedGuild()) return interaction.respond([]);

	const focused = interaction.options.getFocused();
	const presets = await db.query.moderationPresets.findMany({
		where: eq(schema.moderationPresets.guildId, interaction.guild.id),
	});

	if (!presets.length) return interaction.respond([]);

	const filtered = presets.filter((p) => p.reason.toLowerCase().includes(focused.toLowerCase())).slice(0, 25);

	return interaction.respond(
		filtered.map((p) => ({
			name: p.reason.slice(0, 100),
			value: p.reason.slice(0, 100),
		})),
	);
}

/**
 * Deletes up to N recent messages by a specific user in a channel.
 */
export async function deleteRecentUserMessages(
	channel: import('discord.js').GuildTextBasedChannel,
	userId: string,
	amount: number,
): Promise<number> {
	if (amount <= 0) return 0;

	// Fetch up to 100 messages in the channel
	const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
	if (!messages) return 0;

	// Filter messages sent by the target user
	const userMessages = messages.filter((m) => m.author.id === userId).first(amount);
	if (userMessages.length === 0) return 0;

	// Split messages into bulk deletable (younger than 14 days) and individual deletable
	const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
	const bulkDeletable: string[] = [];
	const individualDeletable: import('discord.js').Message[] = [];

	for (const msg of userMessages) {
		if (msg.createdTimestamp > fourteenDaysAgo) {
			bulkDeletable.push(msg.id);
		} else {
			individualDeletable.push(msg);
		}
	}

	let deletedCount = 0;

	if (bulkDeletable.length > 0) {
		const deleted = await channel.bulkDelete(bulkDeletable, true).catch(() => null);
		if (deleted) {
			deletedCount += deleted.size;
		}
	}

	for (const msg of individualDeletable) {
		const success = await msg.delete().catch(() => null);
		if (success) {
			deletedCount++;
		}
	}

	return deletedCount;
}
