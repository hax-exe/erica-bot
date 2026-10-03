/**
 * Shared pieces of `/mod announce` and `/schedule`: color presets, the announcement modal, the
 * ping permission rule, the ping message and the CV2 container. Also holds the in-memory store
 * of `/schedule create` options waiting for their modal.
 *
 * No database import here: unit tests load this file without MySQL.
 */

import { randomBytes } from 'node:crypto';
import {
	ActionRowBuilder,
	type ContainerBuilder,
	type GuildBasedChannel,
	type GuildMember,
	type MessageMentionOptions,
	ModalBuilder,
	PermissionFlagsBits,
	TextDisplayBuilder,
	TextInputBuilder,
	TextInputStyle,
} from 'discord.js';
import type { AnnouncementPingType } from '../db/schema.js';
import { makeContainer, separator } from './components.js';

// ─── Colors ───────────────────────────────────────────────────────────────────

export const ANNOUNCE_COLOR_PRESETS: Record<string, number> = {
	blue: 0x5865f2,
	green: 0x57f287,
	yellow: 0xfee75c,
	red: 0xed4245,
	purple: 0x9b59b6,
	teal: 0x1abc9c,
	white: 0xffffff,
};

export const DEFAULT_ANNOUNCE_COLOR = 'blue';

/** Slash-command choices for the presets, in preset order (`Blue`, `Green`, …). */
export const ANNOUNCE_COLOR_CHOICES = Object.keys(ANNOUNCE_COLOR_PRESETS).map((key) => ({
	name: key.charAt(0).toUpperCase() + key.slice(1),
	value: key,
}));

/** Accent color for a preset key; unknown keys fall back to blue. */
export function resolveAnnounceColor(key: string | null | undefined): number {
	if (key && Object.hasOwn(ANNOUNCE_COLOR_PRESETS, key)) return ANNOUNCE_COLOR_PRESETS[key];
	return ANNOUNCE_COLOR_PRESETS[DEFAULT_ANNOUNCE_COLOR];
}

// ─── Modal ────────────────────────────────────────────────────────────────────

/** The heading + body modal. Field IDs `heading` and `body` are read by the submit listeners. */
export function buildAnnouncementModal(options: {
	customId: string;
	title?: string;
	bodyMaxLength?: number;
}): ModalBuilder {
	const body = new TextInputBuilder()
		.setCustomId('body')
		.setLabel('Message')
		.setStyle(TextInputStyle.Paragraph)
		.setRequired(true);
	if (options.bodyMaxLength !== undefined) body.setMaxLength(options.bodyMaxLength);

	return new ModalBuilder()
		.setCustomId(options.customId)
		.setTitle(options.title ?? 'New Announcement')
		.addComponents(
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder()
					.setCustomId('heading')
					.setLabel('Heading (optional)')
					.setStyle(TextInputStyle.Short)
					.setRequired(false)
					.setMaxLength(100),
			),
			new ActionRowBuilder<TextInputBuilder>().addComponents(body),
		);
}

// ─── Ping ─────────────────────────────────────────────────────────────────────

export const ANNOUNCE_PING_PERMISSION_ERROR =
	'You need the **Mention @everyone, @here, and All Roles** permission to ping that role there.';

/**
 * Mirror Discord's own rule: @everyone and non-mentionable roles need Mention Everyone in that
 * channel. User pings and mentionable (or uncached) roles are always allowed.
 */
export function canSendAnnouncePing(
	member: GuildMember,
	channel: GuildBasedChannel,
	pingType: string | null | undefined,
	pingId: string | null | undefined,
): boolean {
	if (pingType !== 'r' || !pingId) return true;
	const guildId = member.guild.id;
	const role = pingId === guildId ? null : member.guild.roles.cache.get(pingId);
	const needsMentionEveryone = pingId === guildId || (role != null && !role.mentionable);
	if (!needsMentionEveryone) return true;
	return channel.permissionsFor(member)?.has(PermissionFlagsBits.MentionEveryone) ?? false;
}

// ─── Bot access ───────────────────────────────────────────────────────────────

/**
 * What the bot is missing to post an announcement in `channel` (empty when it can). Needs View
 * Channel plus Send Messages, or Send Messages in Threads for a thread. A missing member (the bot
 * could not be resolved) or an unresolvable channel counts as missing everything.
 */
export function missingBotPostPermissions(channel: GuildBasedChannel, me: GuildMember | null | undefined): string[] {
	const needed: Array<[bigint, string]> = [
		[PermissionFlagsBits.ViewChannel, 'View Channel'],
		channel.isThread()
			? [PermissionFlagsBits.SendMessagesInThreads, 'Send Messages in Threads']
			: [PermissionFlagsBits.SendMessages, 'Send Messages'],
	];
	const perms = me ? channel.permissionsFor(me) : null;
	return needed.filter(([flag]) => !perms?.has(flag)).map(([, name]) => name);
}

/** Ephemeral error text when the bot cannot post in `channel`, or null when it can. */
export function botPostPermissionError(channel: GuildBasedChannel, me: GuildMember | null | undefined): string | null {
	const missing = missingBotPostPermissions(channel, me);
	if (!missing.length) return null;
	return `I can't post in <#${channel.id}>. I'm missing **${missing.join('** and **')}** there. Grant ${
		missing.length === 1 ? 'it' : 'them'
	} and try again.`;
}

// ─── Creator authority at send time ───────────────────────────────────────────

/** Whether a due schedule may still go out, and whether its ping may go with it. */
export type ScheduleAuthority = { ok: true; pingAllowed: boolean } | { ok: false; reason: string };

/**
 * Re-check a schedule's creator when it fires. The creator must still be a member with Manage
 * Server; otherwise the schedule must not send. When they are, the ping goes out only if they
 * still pass the `/mod announce` ping rule in that channel (`pingAllowed`); without it the
 * announcement is sent unpinged.
 */
export function checkScheduleAuthority(
	creator: GuildMember | null | undefined,
	channel: GuildBasedChannel,
	pingType: string | null | undefined,
	pingId: string | null | undefined,
): ScheduleAuthority {
	if (!creator) return { ok: false, reason: 'its creator is no longer a member of the server.' };
	if (!creator.permissions.has(PermissionFlagsBits.ManageGuild)) {
		return { ok: false, reason: 'its creator no longer has the Manage Server permission.' };
	}
	return { ok: true, pingAllowed: canSendAnnouncePing(creator, channel, pingType, pingId) };
}

/**
 * The plain ping message sent before the container, allowing exactly that one mention to notify.
 * The @everyone role is only pinged by the literal `@everyone` text, not its `<@&id>` role mention.
 */
export function buildAnnouncementPing(
	guildId: string,
	pingType: string | null | undefined,
	pingId: string | null | undefined,
): { content: string; allowedMentions: MessageMentionOptions } | undefined {
	if (pingType === 'r' && pingId === guildId) {
		return { content: '@everyone', allowedMentions: { parse: ['everyone'] } };
	}
	if (pingType === 'r' && pingId) {
		return { content: `<@&${pingId}>`, allowedMentions: { roles: [pingId] } };
	}
	if (pingType === 'u' && pingId) {
		return { content: `<@${pingId}>`, allowedMentions: { users: [pingId] } };
	}
	return undefined;
}

// ─── Container ────────────────────────────────────────────────────────────────

/** Announcement card: optional heading, body, separator, then a `-#` footer line. */
export function buildAnnouncementContainer(options: {
	color: number;
	heading: string | null | undefined;
	body: string;
	footer: string;
}): ContainerBuilder {
	const container = makeContainer({ color: options.color, header: options.heading ?? undefined });
	container.addTextDisplayComponents(new TextDisplayBuilder().setContent(options.body));
	container.addSeparatorComponents(separator());
	container.addTextDisplayComponents(new TextDisplayBuilder().setContent(options.footer));
	return container;
}

// ─── Scheduling ───────────────────────────────────────────────────────────────

export const SCHEDULE_MIN_DELAY_MS = 60_000; // 1 minute
export const SCHEDULE_MAX_DELAY_MS = 365 * 86_400_000; // 365 days
export const SCHEDULE_MIN_INTERVAL_MS = 10 * 60_000; // 10 minutes
export const SCHEDULE_MAX_INTERVAL_MS = 365 * 86_400_000; // 365 days
export const MAX_ACTIVE_SCHEDULES = 25;
/**
 * Body cap for scheduled announcements. A CV2 message holds at most 4000 characters of text;
 * this leaves room for the heading (100) and the footer, so a schedule can never fail to send
 * for being too long.
 */
export const SCHEDULE_BODY_MAX_LENGTH = 3800;

/**
 * The next run of a recurring schedule after a send: whole intervals past `nextRunAt`, strictly
 * after `now`, always at least one interval ahead. Runs missed while the bot was down are skipped.
 */
export function advanceNextRun(nextRunAt: number, intervalMs: number, now: number): number {
	if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
		throw new RangeError(`intervalMs must be a positive number, got ${intervalMs}`);
	}
	const steps = Math.max(1, Math.floor((now - nextRunAt) / intervalMs) + 1);
	return nextRunAt + steps * intervalMs;
}

/** `/schedule create` options waiting for the modal submit. */
export interface PendingSchedule {
	userId: string;
	guildId: string;
	channelId: string;
	delayMs: number;
	intervalMs: number | null;
	pingType: AnnouncementPingType | null;
	pingId: string | null;
	color: string;
}

export const PENDING_SCHEDULE_TTL_MS = 15 * 60_000;

/** One pending form per user (Discord shows one modal at a time); a new one replaces the old. */
const pendingSchedules = new Map<string, PendingSchedule & { nonce: string; expiresAt: number }>();

function prunePendingSchedules(now: number): void {
	for (const [userId, entry] of pendingSchedules) {
		if (entry.expiresAt <= now) pendingSchedules.delete(userId);
	}
}

/** Keep the options for 15 minutes; returns the nonce for the `schedule_modal:<nonce>` custom ID. */
export function storePendingSchedule(pending: PendingSchedule, now = Date.now()): string {
	prunePendingSchedules(now);
	const nonce = randomBytes(4).toString('hex');
	pendingSchedules.set(pending.userId, { ...pending, nonce, expiresAt: now + PENDING_SCHEDULE_TTL_MS });
	return nonce;
}

/** Remove and return the user's pending options if the nonce matches and they have not expired. */
export function takePendingSchedule(userId: string, nonce: string, now = Date.now()): PendingSchedule | null {
	prunePendingSchedules(now);
	const entry = pendingSchedules.get(userId);
	if (!entry || entry.nonce !== nonce) return null;
	pendingSchedules.delete(userId);
	const { nonce: _nonce, expiresAt: _expiresAt, ...pending } = entry;
	return pending;
}
