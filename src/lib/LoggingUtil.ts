import type { Guild } from 'discord.js';
import { channelMention, type Role, User, userMention, WebhookClient } from 'discord.js';
import { eq } from 'drizzle-orm';
import { WEBHOOK_NAMES } from './brand.js';
import { type LogEmbed, logMessage } from './components.js';
import { db, schema } from './database.js';

// ─── Guild settings helpers ────────────────────────────────────────────────────

export async function getGuildSettings(guildId: string) {
	const result = await db.select().from(schema.guilds).where(eq(schema.guilds.id, guildId)).limit(1);
	return result[0] ?? null;
}

export async function upsertGuildSettings(guildId: string, patch: Partial<typeof schema.guilds.$inferInsert>) {
	await db
		.insert(schema.guilds)
		.values({ id: guildId, ...patch })
		.onDuplicateKeyUpdate({
			set: patch,
		});
}

/**
 * Rename every configured logging webhook to the current Erica branding.
 * Webhooks created under an older bot name are updated in place at startup.
 */
export async function syncWebhookBranding(): Promise<{ updated: number; failed: number }> {
	const rows = await db
		.select({
			logWebhookUrl: schema.guilds.logWebhookUrl,
			modLogWebhookUrl: schema.guilds.modLogWebhookUrl,
			ticketLogWebhookUrl: schema.guilds.ticketLogWebhookUrl,
			reportWebhookUrl: schema.guilds.reportWebhookUrl,
		})
		.from(schema.guilds);

	const targets: Array<{ url: string | null; name: string }> = [];
	for (const row of rows) {
		targets.push(
			{ url: row.logWebhookUrl, name: WEBHOOK_NAMES.logs },
			{ url: row.modLogWebhookUrl, name: WEBHOOK_NAMES.modLogs },
			{ url: row.ticketLogWebhookUrl, name: WEBHOOK_NAMES.ticketLogs },
			{ url: row.reportWebhookUrl, name: WEBHOOK_NAMES.reportLogs },
		);
	}

	let updated = 0;
	let failed = 0;
	for (const target of targets) {
		if (!target.url) continue;
		let wh: WebhookClient | null = null;
		try {
			// Constructed inside try: a malformed stored URL throws here and must not abort the sync.
			wh = new WebhookClient({ url: target.url });
			await wh.edit({ name: target.name });
			updated++;
		} catch {
			failed++;
		} finally {
			wh?.destroy();
		}
	}

	return { updated, failed };
}

/** Best-effort delete of a logging webhook by its stored URL (channel moved or cleared). Never throws. */
export async function deleteWebhookByUrl(url: string | null | undefined, reason?: string): Promise<void> {
	if (!url) return;
	let wh: WebhookClient | null = null;
	try {
		wh = new WebhookClient({ url });
		await wh.delete(reason);
	} catch {
		// Already deleted, malformed URL or no access — nothing left to clean up
	} finally {
		wh?.destroy();
	}
}

// ─── Shared log copy ───────────────────────────────────────────────────────────

export const LogEmpty = {
	none: '*(none)*',
	unknown: '*(unknown)*',
	notCached: '*(not cached)*',
	noText: '*(no text content)*',
} as const;

/**
 * Formats an audit log target (User or Role) into a readable string.
 * Handles the @everyone case (where target ID == guild ID) to prevent "Unknown User" logs.
 */
export function formatAuditTarget(guild: Guild, id: string, target?: User | Role | null): string {
	if (id === guild.id) return '`@everyone`';
	if (target instanceof User) return formatUser(target.id);
	if (target && 'name' in target) return `${(target as Role).name} (\`${id}\`)`;
	const role = guild.roles.cache.get(id);
	if (role) return `${role.name} (\`${id}\`)`;
	return formatUser(id);
}

/** User display for logs: @mention (`id`) */
export function formatUser(id: string, _username?: string | null): string {
	return `${userMention(id)} (\`${id}\`)`;
}

/** Channel display for logs: #channel */
export function formatChannel(id: string): string {
	return channelMention(id);
}

/** Jump link for logs */
export function formatJump(url: string, label = 'View'): string {
	return `[${label}](${url})`;
}

/** Canonical log field builders — keep names/values consistent across the bot. */
export const logFields = {
	user: (id: string) => ({ name: 'User', value: formatUser(id) }),
	moderator: (id: string) => ({ name: 'Moderator', value: formatUser(id) }),
	openedBy: (id: string) => ({ name: 'Opened By', value: formatUser(id) }),
	closedBy: (id: string) => ({ name: 'Closed By', value: formatUser(id) }),
	changedBy: (id: string) => ({ name: 'Changed By', value: formatUser(id) }),
	deletedBy: (id: string) => ({ name: 'Deleted By', value: formatUser(id) }),
	channel: (id: string) => ({ name: 'Channel', value: formatChannel(id) }),
	reason: (text: string) => ({ name: 'Reason', value: text.trim() || LogEmpty.none }),
	before: (text: string) => ({ name: 'Before', value: text.trim() || LogEmpty.none }),
	after: (text: string) => ({ name: 'After', value: text.trim() || LogEmpty.none }),
	message: (text: string) => ({ name: 'Message', value: text.trim() || LogEmpty.noText }),
	messageId: (id: string) => ({ name: 'Message ID', value: `\`${id}\`` }),
	case: (id: string | number) => ({ name: 'Case', value: `\`${id}\`` }),
	ticketId: (id: string | number) => ({ name: 'Ticket ID', value: `\`${id}\`` }),
	category: (label: string) => ({ name: 'Category', value: label }),
	duration: (text: string) => ({ name: 'Duration', value: text }),
	jump: (url: string) => ({ name: 'Jump', value: formatJump(url) }),
	transcript: (url: string) => ({ name: 'Transcript', value: formatJump(url) }),
	accountCreated: (unixSec: number) => ({ name: 'Account Created', value: `<t:${unixSec}:R>` }),
	joined: (unixSec: number) => ({ name: 'Joined', value: `<t:${unixSec}:R>` }),
	messageCreated: (unixSec: number) => ({ name: 'Message Created', value: `<t:${unixSec}:R>` }),
	memberCount: (n: number) => ({ name: 'Member Count', value: n.toLocaleString() }),
	oldNew: (label: string, oldVal: string, newVal: string) =>
		[
			{ name: `Old ${label}`, value: oldVal.trim() || LogEmpty.none },
			{ name: `New ${label}`, value: newVal.trim() || LogEmpty.none },
		] as const,
} as const;

// ─── Webhook dispatch helpers ──────────────────────────────────────────────────

/**
 * Deliver a payload to a log webhook. Never throws — logging must not interrupt the bot.
 * @returns true when sent; false when no webhook is configured or delivery failed (incl. a malformed URL).
 */
async function sendToWebhook(url: string | null | undefined, payload: Record<string, unknown>): Promise<boolean> {
	if (!url) return false;
	let wh: WebhookClient | null = null;
	try {
		wh = new WebhookClient({ url });
		await wh.send(payload);
		return true;
	} catch {
		return false;
	} finally {
		wh?.destroy();
	}
}

/**
 * Send a log embed to the guild's general log webhook. Silently fails if
 * the webhook is not configured or the channelId is on the ignore list.
 */
export async function sendLog(guild: Guild, embed: LogEmbed, channelId?: string): Promise<void> {
	const settings = await getGuildSettings(guild.id);
	if (channelId && settings?.logIgnoredChannelIds) {
		try {
			const ignored = JSON.parse(settings.logIgnoredChannelIds) as string[];
			if (ignored.includes(channelId)) return;
		} catch {
			// biome-ignore lint/suspicious/noConsole: one-time warning for misconfigured data
			console.warn(`[LoggingUtil] Malformed logIgnoredChannelIds JSON for guild ${guild.id} — ignoring filter`);
		}
	}
	await sendToWebhook(settings?.logWebhookUrl, logMessage(embed));
}

/**
 * Send raw files as a separate message to the guild's general log webhook.
 */
export async function sendLogFiles(guild: Guild, files: any[], content?: string, channelId?: string): Promise<void> {
	const settings = await getGuildSettings(guild.id);
	if (channelId && settings?.logIgnoredChannelIds) {
		try {
			const ignored = JSON.parse(settings.logIgnoredChannelIds) as string[];
			if (ignored.includes(channelId)) return;
		} catch {}
	}
	await sendToWebhook(settings?.logWebhookUrl, { content: content ?? '', files, allowedMentions: { parse: [] } });
}

/**
 * Send a log embed to the guild's moderation log webhook.
 */
export async function sendModLog(guild: Guild, embed: LogEmbed, files?: any[]): Promise<void> {
	const settings = await getGuildSettings(guild.id);
	const payload: any = { ...logMessage(embed) };
	if (files && files.length > 0) {
		payload.files = files;
	}
	await sendToWebhook(settings?.modLogWebhookUrl, payload);
}

/**
 * Send a log embed to the guild's ticket log webhook.
 */
export async function sendTicketLog(guild: Guild, embed: LogEmbed): Promise<void> {
	const settings = await getGuildSettings(guild.id);
	await sendToWebhook(settings?.ticketLogWebhookUrl, logMessage(embed));
}

/**
 * Send a log embed to the guild's report webhook.
 * Returns true when the report was delivered; false when no report webhook is configured or the send failed.
 */
export async function sendReportLog(guild: Guild, embed: LogEmbed): Promise<boolean> {
	const settings = await getGuildSettings(guild.id);
	return sendToWebhook(settings?.reportWebhookUrl, logMessage(embed));
}

/**
 * Send a file attachment to the guild's ticket log webhook (e.g. transcripts).
 */
export async function sendTicketFile(
	guild: Guild,
	content: string,
	files: { attachment: Buffer; name: string }[],
): Promise<void> {
	const settings = await getGuildSettings(guild.id);
	await sendToWebhook(settings?.ticketLogWebhookUrl, { content, files, allowedMentions: { parse: [] } });
}
