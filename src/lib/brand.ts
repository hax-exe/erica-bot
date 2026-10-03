/**
 * Single source of truth for the bot's public-facing name and identifiers.
 * Use these constants instead of hard-coding the bot name in strings.
 */

export const BOT_NAME = 'Erica';

/** Brand accent (soft violet) for informational cards and panels. */
export const BRAND_COLOR = 0x8b7cf6;

/** Bot version advertised to external services (User-Agent, Lavalink client name). */
export const BOT_VERSION = '1.0.0';

/** User-Agent header for every outbound HTTP request. */
export const USER_AGENT = `${BOT_NAME}/${BOT_VERSION}`;

/** Display names for the logging webhooks the bot creates and keeps in sync on startup. */
export const WEBHOOK_NAMES = {
	logs: `${BOT_NAME} — Logs`,
	modLogs: `${BOT_NAME} — Moderation Logs`,
	ticketLogs: `${BOT_NAME} — Ticket Logs`,
	reportLogs: `${BOT_NAME} — Report Logs`,
} as const;

/**
 * Browser origins allowed to call the HTTP API (CORS). Comma-separated `API_ALLOWED_ORIGINS`;
 * empty when unset (server-to-server calls without an Origin header are unaffected).
 */
export function getAllowedOrigins(): string[] {
	return (process.env.API_ALLOWED_ORIGINS ?? '')
		.split(',')
		.map((o) => o.trim().replace(/\/+$/, ''))
		.filter(Boolean);
}
