import { container } from '@sapphire/framework';
import { ChannelType } from 'discord.js';
import { and, asc, count, desc, eq } from 'drizzle-orm';
import { WEBHOOK_NAMES } from './brand.js';
import { db, schema } from './database.js';
import { resolveBlueskyHandle, resolveRssFeed } from './FeedPoller.js';
import { deleteWebhookByUrl } from './LoggingUtil.js';
import { invalidateModuleCache, setModule } from './ModuleUtil.js';
import { isDuplicateKeyError } from './safe.js';

type SettingsPatch = {
	logChannelId?: string;
	modLogChannelId?: string;
	ticketLogChannelId?: string;
	reportChannelId?: string;
	clearLog?: boolean;
	clearModLog?: boolean;
	clearTicketLog?: boolean;
	clearReport?: boolean;
	logIgnoredChannelIds?: string[];
};

/** Log webhooks the settings PATCH can point at a channel (creating a webhook there) or clear. */
const LOG_WEBHOOK_TARGETS = [
	{
		channelKey: 'logChannelId',
		clearKey: 'clearLog',
		urlKey: 'logWebhookUrl',
		name: WEBHOOK_NAMES.logs,
		label: 'Log channel',
	},
	{
		channelKey: 'modLogChannelId',
		clearKey: 'clearModLog',
		urlKey: 'modLogWebhookUrl',
		name: WEBHOOK_NAMES.modLogs,
		label: 'Moderation log channel',
	},
	{
		channelKey: 'ticketLogChannelId',
		clearKey: 'clearTicketLog',
		urlKey: 'ticketLogWebhookUrl',
		name: WEBHOOK_NAMES.ticketLogs,
		label: 'Ticket log channel',
	},
	{
		channelKey: 'reportChannelId',
		clearKey: 'clearReport',
		urlKey: 'reportWebhookUrl',
		name: WEBHOOK_NAMES.reportLogs,
		label: 'Report channel',
	},
] as const;

/** JSON-text columns holding string arrays (IDs / domains); other code reads them back with JSON.parse. */
const AUTOMOD_ARRAY_FIELDS = ['linkWhitelist', 'exemptRoles', 'exemptChannels'] as const;
const LEVELING_ARRAY_FIELDS = ['noXpRoleIds', 'noXpChannelIds', 'noXpVoiceChannelIds'] as const;

/** Accept a string array (or a JSON string encoding one) and return its JSON text; null when invalid. */
function toStringArrayJson(value: unknown): string | null {
	let parsed = value;
	if (typeof value === 'string') {
		try {
			parsed = JSON.parse(value);
		} catch {
			return null;
		}
	}
	return Array.isArray(parsed) && parsed.every((v) => typeof v === 'string') ? JSON.stringify(parsed) : null;
}

/**
 * Normalise the given JSON string-array fields of `patch` in place.
 * @returns the first invalid field name, or null when every present field is valid.
 */
function normalizeArrayFields(patch: Record<string, unknown>, fields: readonly string[]): string | null {
	for (const field of fields) {
		if (patch[field] === undefined) continue;
		const json = toStringArrayJson(patch[field]);
		if (json === null) return field;
		patch[field] = json;
	}
	return null;
}

/** True when `value` is JSON text for a plain object (tag embeds). */
function isJsonObjectText(value: unknown): boolean {
	if (typeof value !== 'string') return false;
	try {
		const parsed: unknown = JSON.parse(value);
		return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
	} catch {
		return false;
	}
}

/** Decode a URL path segment; null when it is not valid percent-encoding. */
function decodePathSegment(raw: string): string | null {
	try {
		return decodeURIComponent(raw);
	} catch {
		return null;
	}
}

/** Fetch a guild the bot is in; null when Discord reports it unknown or inaccessible (not a member). */
async function fetchGuildOrNull(guildId: string, force = false) {
	if (!/^\d{17,20}$/.test(guildId)) return null;
	try {
		return force
			? await container.client.guilds.fetch({ guild: guildId, force: true })
			: await container.client.guilds.fetch(guildId);
	} catch (e) {
		const { code, status } = (e ?? {}) as { code?: unknown; status?: unknown };
		// 10004 Unknown Guild / 50001 Missing Access
		if (code === 10004 || code === 50001 || status === 403 || status === 404) return null;
		throw e;
	}
}

/** Strip PK / cross-guild fields so callers can't overwrite another guild's row. */
function sanitizeGuildPatch<T extends Record<string, unknown>>(
	body: T,
	guildId: string,
): Omit<T, 'guildId' | 'id'> & { guildId: string } {
	const { guildId: _g, id: _i, ...rest } = body as T & { guildId?: string; id?: string };
	return { ...(rest as Omit<T, 'guildId' | 'id'>), guildId };
}

/** Never return raw Discord webhook tokens to API clients. */
function maskWebhookUrl(url: string | null | undefined): string | null {
	if (!url) return null;
	try {
		const u = new URL(url);
		const parts = u.pathname.split('/').filter(Boolean);
		// /api/webhooks/{id}/{token}
		if (parts.length >= 3) {
			parts[parts.length - 1] = '***';
			u.pathname = `/${parts.join('/')}`;
			return u.toString();
		}
		return '[configured]';
	} catch {
		return '[configured]';
	}
}

export async function handleGuildRoute(req: Request, guildId: string, sub: string): Promise<Response> {
	const method = req.method;

	async function parseBody<T>(): Promise<T | null> {
		try {
			return (await req.json()) as T;
		} catch {
			return null;
		}
	}

	function ok(data: unknown = { ok: true }): Response {
		return Response.json(data);
	}

	function err(msg: string, status = 400): Response {
		return Response.json({ error: msg }, { status });
	}

	try {
		// ── Guild overview ────────────────────────────────────────────────────────
		if ((sub === '' || sub === '/') && method === 'GET') {
			const guild = await fetchGuildOrNull(guildId);
			if (!guild) return err('Guild not found', 404);

			const [modulesRow, infractionCount, openTicketCount, activeFeedCount] = await Promise.all([
				db
					.select()
					.from(schema.guildModules)
					.where(eq(schema.guildModules.guildId, guildId))
					.limit(1)
					.then((rows) => rows[0]),
				db
					.select({ value: count() })
					.from(schema.infractions)
					.where(eq(schema.infractions.guildId, guildId))
					.limit(1)
					.then((rows) => rows[0]),
				db
					.select({ value: count() })
					.from(schema.tickets)
					.where(and(eq(schema.tickets.guildId, guildId), eq(schema.tickets.status, 'open')))
					.limit(1)
					.then((rows) => rows[0]),
				db
					.select({ value: count() })
					.from(schema.socialFeeds)
					.where(eq(schema.socialFeeds.guildId, guildId))
					.limit(1)
					.then((rows) => rows[0]),
			]);

			return ok({
				guild: {
					id: guild.id,
					name: guild.name,
					icon: guild.icon,
					memberCount: guild.memberCount,
				},
				modules: modulesRow ?? null,
				stats: {
					infractions: infractionCount?.value ?? 0,
					openTickets: openTicketCount?.value ?? 0,
					activeFeeds: activeFeedCount?.value ?? 0,
				},
			});
		}

		// ── Channels ──────────────────────────────────────────────────────────────
		if (sub === 'channels' && method === 'GET') {
			const guild = await fetchGuildOrNull(guildId, true);
			if (!guild) return err('Guild not found', 404);
			const channels = guild.channels.cache
				.filter((c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement)
				.map((c) => ({ id: c.id, name: (c as { name: string }).name, type: c.type }))
				.sort((a, b) => a.name.localeCompare(b.name));
			return ok(channels);
		}

		// ── Roles ─────────────────────────────────────────────────────────────────
		if (sub === 'roles' && method === 'GET') {
			const guild = await fetchGuildOrNull(guildId, true);
			if (!guild) return err('Guild not found', 404);
			const roles = guild.roles.cache
				.filter((r) => r.id !== guildId)
				.map((r) => ({ id: r.id, name: r.name, color: r.color, position: r.position }))
				.sort((a, b) => b.position - a.position)
				.map(({ id, name, color }) => ({ id, name, color }));
			return ok(roles);
		}

		// ── Modules ───────────────────────────────────────────────────────────────
		if (sub === 'modules' && method === 'GET') {
			const row = await db
				.select()
				.from(schema.guildModules)
				.where(eq(schema.guildModules.guildId, guildId))
				.limit(1)
				.then((rows) => rows[0]);
			return ok(
				row ?? {
					guildId,
					leveling: true,
					welcomer: true,
					starboard: true,
					birthdays: true,
					spaces: true,
					sticky: true,
					tickets: true,
					tags: true,
					logging: true,
					music: true,
					reactionRoles: true,
					reports: true,
					reviews: true,
					automod: false,
					suggestions: true,
					fun: true,
					giveaways: true,
					economy: true,
					tts: true,
					autoresponder: true,
				},
			);
		}

		if (sub === 'modules' && method === 'PATCH') {
			const body = await parseBody<Partial<typeof schema.guildModules.$inferInsert>>();
			if (!body) return err('Invalid JSON body');
			const patch = sanitizeGuildPatch(body as Record<string, unknown>, guildId);
			await db
				.insert(schema.guildModules)
				.values(patch as typeof schema.guildModules.$inferInsert)
				.onDuplicateKeyUpdate({
					set: patch as Partial<typeof schema.guildModules.$inferInsert>,
				});
			invalidateModuleCache(guildId);
			const updated = await db
				.select()
				.from(schema.guildModules)
				.where(eq(schema.guildModules.guildId, guildId))
				.limit(1)
				.then((rows) => rows[0]);
			return ok(updated);
		}

		// ── Settings ──────────────────────────────────────────────────────────────
		if (sub === 'settings' && method === 'GET') {
			const row = await db
				.select()
				.from(schema.guilds)
				.where(eq(schema.guilds.id, guildId))
				.limit(1)
				.then((rows) => rows[0]);
			if (!row) {
				return ok({
					id: guildId,
					logWebhookUrl: null,
					modLogWebhookUrl: null,
					ticketLogWebhookUrl: null,
					reportWebhookUrl: null,
					logIgnoredChannelIds: '[]',
				});
			}
			return ok({
				...row,
				logWebhookUrl: maskWebhookUrl(row.logWebhookUrl),
				modLogWebhookUrl: maskWebhookUrl(row.modLogWebhookUrl),
				ticketLogWebhookUrl: maskWebhookUrl(row.ticketLogWebhookUrl),
				reportWebhookUrl: maskWebhookUrl(row.reportWebhookUrl),
			});
		}

		if (sub === 'settings' && method === 'PATCH') {
			const body = await parseBody<SettingsPatch>();
			if (!body) return err('Invalid JSON body');

			const set: Partial<typeof schema.guilds.$inferInsert> = {};

			if (body.logIgnoredChannelIds !== undefined) {
				const json = toStringArrayJson(body.logIgnoredChannelIds);
				if (json === null) return err('logIgnoredChannelIds must be an array of channel ID strings');
				set.logIgnoredChannelIds = json;
			}

			const previous = await db
				.select()
				.from(schema.guilds)
				.where(eq(schema.guilds.id, guildId))
				.limit(1)
				.then((rows) => rows[0]);

			// Webhooks created by this request — deleted again if the request fails part-way.
			const created: string[] = [];
			const discardCreated = () =>
				Promise.all(created.map((url) => deleteWebhookByUrl(url, 'Log settings update failed')));

			for (const target of LOG_WEBHOOK_TARGETS) {
				if (body[target.clearKey]) {
					set[target.urlKey] = null;
					continue;
				}
				const channelId = body[target.channelKey];
				if (!channelId) continue;

				const channel = await container.client.channels.fetch(channelId).catch(() => null);
				if (!channel || !('guildId' in channel) || channel.guildId !== guildId) {
					await discardCreated();
					return err(`${target.label} must belong to the configured guild`);
				}
				if ('createWebhook' in channel && typeof channel.createWebhook === 'function') {
					try {
						const webhook = await (
							channel as {
								createWebhook: (opts: { name: string; avatar?: string }) => Promise<{ url: string }>;
							}
						).createWebhook({
							name: target.name,
							avatar: container.client.user?.displayAvatarURL({ extension: 'png', size: 256 }),
						});
						created.push(webhook.url);
						set[target.urlKey] = webhook.url;
					} catch (e) {
						await discardCreated();
						throw e;
					}
				}
			}

			if (Object.keys(set).length === 0) return err('No valid fields');

			try {
				await db
					.insert(schema.guilds)
					.values({ id: guildId, ...set })
					.onDuplicateKeyUpdate({ set });
			} catch (e) {
				await discardCreated();
				throw e;
			}

			const updated = await db
				.select()
				.from(schema.guilds)
				.where(eq(schema.guilds.id, guildId))
				.limit(1)
				.then((rows) => rows[0]);

			// Replaced / cleared webhooks are now unreferenced: delete them so channels don't hit
			// Discord's 15-webhook cap. A URL still stored in another column is kept.
			if (previous && updated) {
				const inUse = new Set(LOG_WEBHOOK_TARGETS.map((t) => updated[t.urlKey]));
				const stale = new Set(
					LOG_WEBHOOK_TARGETS.map((t) => previous[t.urlKey]).filter((url): url is string => !!url && !inUse.has(url)),
				);
				await Promise.all([...stale].map((url) => deleteWebhookByUrl(url, 'Log channel changed via the API')));
			}

			return ok(
				updated
					? {
							...updated,
							logWebhookUrl: maskWebhookUrl(updated.logWebhookUrl),
							modLogWebhookUrl: maskWebhookUrl(updated.modLogWebhookUrl),
							ticketLogWebhookUrl: maskWebhookUrl(updated.ticketLogWebhookUrl),
							reportWebhookUrl: maskWebhookUrl(updated.reportWebhookUrl),
						}
					: updated,
			);
		}

		// ── Automod words (must be checked before 'automod') ─────────────────────
		if (sub === 'automod/words' && method === 'GET') {
			const words = await db
				.select()
				.from(schema.automodWordFilter)
				.where(eq(schema.automodWordFilter.guildId, guildId))
				.orderBy(asc(schema.automodWordFilter.addedAt));
			return ok(words);
		}

		if (sub === 'automod/words' && method === 'POST') {
			const body = await parseBody<{ word: string; isRegex: boolean }>();
			if (!body?.word) return err('Missing word');
			const [idRow] = await db
				.insert(schema.automodWordFilter)
				.values({ guildId, word: body.word, isRegex: body.isRegex ?? false })
				.$returningId();
			const inserted = await db
				.select()
				.from(schema.automodWordFilter)
				.where(eq(schema.automodWordFilter.id, idRow.id))
				.limit(1)
				.then((rows) => rows[0]);
			return ok(inserted);
		}

		if (sub.startsWith('automod/words/') && method === 'DELETE') {
			const id = parseInt(sub.slice('automod/words/'.length), 10);
			if (Number.isNaN(id)) return err('Invalid id');
			await db
				.delete(schema.automodWordFilter)
				.where(and(eq(schema.automodWordFilter.id, id), eq(schema.automodWordFilter.guildId, guildId)));
			return ok();
		}

		// ── Automod settings ──────────────────────────────────────────────────────
		if (sub === 'automod' && method === 'GET') {
			const row = await db
				.select()
				.from(schema.automodSettings)
				.where(eq(schema.automodSettings.guildId, guildId))
				.limit(1)
				.then((rows) => rows[0]);
			return ok(row ?? null);
		}

		if (sub === 'automod' && method === 'PATCH') {
			const body = await parseBody<Partial<typeof schema.automodSettings.$inferInsert>>();
			if (!body) return err('Invalid JSON body');
			const patch: Record<string, unknown> = sanitizeGuildPatch(body as Record<string, unknown>, guildId);
			const badField = normalizeArrayFields(patch, AUTOMOD_ARRAY_FIELDS);
			if (badField) return err(`${badField} must be an array of strings`);
			await db
				.insert(schema.automodSettings)
				.values(patch as any)
				.onDuplicateKeyUpdate({
					set: patch as any,
				});
			// Rules only run while the AutoMod module is on — enabling one turns it on, as /automod toggle does.
			if (Object.entries(patch).some(([key, value]) => key.endsWith('Enabled') && value === true)) {
				await setModule(guildId, 'automod', true);
			}
			const updated = await db
				.select()
				.from(schema.automodSettings)
				.where(eq(schema.automodSettings.guildId, guildId))
				.limit(1)
				.then((rows) => rows[0]);
			return ok(updated);
		}

		// ── Infractions ───────────────────────────────────────────────────────────
		if (sub === 'infractions' && method === 'GET') {
			const url = new URL(req.url);
			const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
			const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '25', 10)));
			const offset = (page - 1) * limit;

			const [rows, totalRow] = await Promise.all([
				db
					.select()
					.from(schema.infractions)
					.where(eq(schema.infractions.guildId, guildId))
					.orderBy(desc(schema.infractions.createdAt))
					.limit(limit)
					.offset(offset),
				db
					.select({ value: count() })
					.from(schema.infractions)
					.where(eq(schema.infractions.guildId, guildId))
					.limit(1)
					.then((rows) => rows[0]),
			]);

			return ok({ infractions: rows, total: totalRow?.value ?? 0, page, limit });
		}

		if (sub.startsWith('infractions/') && method === 'DELETE') {
			const id = parseInt(sub.slice('infractions/'.length), 10);
			if (Number.isNaN(id)) return err('Invalid id');
			await db
				.delete(schema.infractions)
				.where(and(eq(schema.infractions.id, id), eq(schema.infractions.guildId, guildId)));
			return ok();
		}

		// ── Welcome ───────────────────────────────────────────────────────────────
		if (sub === 'welcome' && method === 'GET') {
			const row = await db
				.select()
				.from(schema.welcomeSettings)
				.where(eq(schema.welcomeSettings.guildId, guildId))
				.limit(1)
				.then((rows) => rows[0]);
			return ok(row ?? null);
		}

		if (sub === 'welcome' && method === 'PATCH') {
			const body = await parseBody<Partial<typeof schema.welcomeSettings.$inferInsert>>();
			if (!body) return err('Invalid JSON body');
			await db
				.insert(schema.welcomeSettings)
				.values(sanitizeGuildPatch(body as Record<string, unknown>, guildId) as any)
				.onDuplicateKeyUpdate({
					set: sanitizeGuildPatch(body as Record<string, unknown>, guildId) as any,
				});
			const updated = await db
				.select()
				.from(schema.welcomeSettings)
				.where(eq(schema.welcomeSettings.guildId, guildId))
				.limit(1)
				.then((rows) => rows[0]);
			return ok(updated);
		}

		// ── Leave ─────────────────────────────────────────────────────────────────
		if (sub === 'leave' && method === 'GET') {
			const row = await db
				.select()
				.from(schema.leaveSettings)
				.where(eq(schema.leaveSettings.guildId, guildId))
				.limit(1)
				.then((rows) => rows[0]);
			return ok(row ?? null);
		}

		if (sub === 'leave' && method === 'PATCH') {
			const body = await parseBody<Partial<typeof schema.leaveSettings.$inferInsert>>();
			if (!body) return err('Invalid JSON body');
			await db
				.insert(schema.leaveSettings)
				.values(sanitizeGuildPatch(body as Record<string, unknown>, guildId) as any)
				.onDuplicateKeyUpdate({
					set: sanitizeGuildPatch(body as Record<string, unknown>, guildId) as any,
				});
			const updated = await db
				.select()
				.from(schema.leaveSettings)
				.where(eq(schema.leaveSettings.guildId, guildId))
				.limit(1)
				.then((rows) => rows[0]);
			return ok(updated);
		}

		// ── Leveling roles (must be before 'leveling') ────────────────────────────
		if (sub === 'leveling/roles' && method === 'GET') {
			const roles = await db
				.select()
				.from(schema.levelRoles)
				.where(eq(schema.levelRoles.guildId, guildId))
				.orderBy(asc(schema.levelRoles.level));
			return ok(roles);
		}

		if (sub === 'leveling/roles' && method === 'POST') {
			const body = await parseBody<{ level: number; roleId: string }>();
			if (body?.level === undefined || !body.roleId) return err('Missing level or roleId');
			const [idRow] = await db
				.insert(schema.levelRoles)
				.values({ guildId, level: body.level, roleId: body.roleId })
				.$returningId();
			const inserted = await db
				.select()
				.from(schema.levelRoles)
				.where(eq(schema.levelRoles.id, idRow.id))
				.limit(1)
				.then((rows) => rows[0]);
			return ok(inserted);
		}

		if (sub.startsWith('leveling/roles/') && method === 'DELETE') {
			const level = parseInt(sub.slice('leveling/roles/'.length), 10);
			if (Number.isNaN(level)) return err('Invalid level');
			await db
				.delete(schema.levelRoles)
				.where(and(eq(schema.levelRoles.guildId, guildId), eq(schema.levelRoles.level, level)));
			return ok();
		}

		// ── Leveling settings ─────────────────────────────────────────────────────
		if (sub === 'leveling' && method === 'GET') {
			const [settings, roles] = await Promise.all([
				db
					.select()
					.from(schema.levelSettings)
					.where(eq(schema.levelSettings.guildId, guildId))
					.limit(1)
					.then((rows) => rows[0]),
				db
					.select()
					.from(schema.levelRoles)
					.where(eq(schema.levelRoles.guildId, guildId))
					.orderBy(asc(schema.levelRoles.level)),
			]);
			return ok({ settings: settings ?? null, roles });
		}

		if (sub === 'leveling' && method === 'PATCH') {
			const body = await parseBody<Partial<typeof schema.levelSettings.$inferInsert>>();
			if (!body) return err('Invalid JSON body');
			const patch: Record<string, unknown> = sanitizeGuildPatch(body as Record<string, unknown>, guildId);
			const badField = normalizeArrayFields(patch, LEVELING_ARRAY_FIELDS);
			if (badField) return err(`${badField} must be an array of strings`);
			await db
				.insert(schema.levelSettings)
				.values(patch as any)
				.onDuplicateKeyUpdate({
					set: patch as any,
				});
			const updated = await db
				.select()
				.from(schema.levelSettings)
				.where(eq(schema.levelSettings.guildId, guildId))
				.limit(1)
				.then((rows) => rows[0]);
			return ok(updated);
		}

		// ── Tickets (YAML config — read-only via API) ─────────────────────────────
		if (
			(sub === 'tickets' || sub === 'tickets/categories' || sub.startsWith('tickets/categories/')) &&
			(method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE')
		) {
			return err('Ticket config is file-based. Edit config/tickets.yml and use /ticket reload.', 405);
		}

		if (sub === 'tickets' && method === 'GET') {
			const { getLoadedTicketsConfig, getTicketSettingsFromConfig, getGuildCategoriesFromConfig } = await import(
				'./TicketsConfig.js'
			);
			if (!getLoadedTicketsConfig()) {
				return err('Ticket config not loaded', 503);
			}
			const settings = getTicketSettingsFromConfig(guildId);
			const categories = getGuildCategoriesFromConfig(guildId);
			return ok({ settings, categories, source: 'config/tickets.yml' });
		}

		// ── Feeds ─────────────────────────────────────────────────────────────────
		if (sub === 'feeds' && method === 'GET') {
			const feeds = await db
				.select()
				.from(schema.socialFeeds)
				.where(eq(schema.socialFeeds.guildId, guildId))
				.orderBy(asc(schema.socialFeeds.createdAt));
			return ok(feeds);
		}

		if (sub === 'feeds' && method === 'POST') {
			const body = await parseBody<{ channelId: string; platform: string; handle: string }>();
			if (!body?.channelId || !body.platform || !body.handle) {
				return err('Missing required fields: channelId, platform, handle');
			}

			let resolvedHandle = body.handle.startsWith('@') ? body.handle.slice(1) : body.handle;
			let displayName = resolvedHandle;

			if (body.platform === 'bluesky') {
				if (!resolvedHandle.includes('.')) resolvedHandle = `${resolvedHandle}.bsky.social`;
				const resolved = await resolveBlueskyHandle(resolvedHandle);
				if (!resolved) return err('Could not resolve Bluesky handle. Make sure the account exists.');
				resolvedHandle = resolved.handle;
				displayName = resolved.displayName;
			} else if (body.platform === 'rss') {
				// handle is the full URL for RSS feeds
				resolvedHandle = body.handle.trim();
				if (!/^https?:\/\/.+/.test(resolvedHandle)) return err('RSS handle must be a full URL (https://...)');
				const resolved = await resolveRssFeed(resolvedHandle);
				if (!resolved) return err('Could not fetch RSS feed. Make sure the URL is a valid RSS or Atom feed.');
				resolvedHandle = resolved.url;
				displayName = resolved.displayName;
			}

			const [idRow] = await db
				.insert(schema.socialFeeds)
				.values({
					guildId,
					channelId: body.channelId,
					platform: body.platform as (typeof schema.socialFeeds.$inferInsert)['platform'],
					handle: resolvedHandle,
					displayName,
				})
				.$returningId();
			const inserted = await db
				.select()
				.from(schema.socialFeeds)
				.where(eq(schema.socialFeeds.id, idRow.id))
				.limit(1)
				.then((rows) => rows[0]);
			return ok(inserted);
		}

		if (sub.startsWith('feeds/') && method === 'DELETE') {
			const id = parseInt(sub.slice('feeds/'.length), 10);
			if (Number.isNaN(id)) return err('Invalid id');
			await db
				.delete(schema.socialFeeds)
				.where(and(eq(schema.socialFeeds.id, id), eq(schema.socialFeeds.guildId, guildId)));
			return ok();
		}

		// ── Starboard ─────────────────────────────────────────────────────────────
		if (sub === 'starboard' && method === 'GET') {
			const row = await db
				.select()
				.from(schema.starboardSettings)
				.where(eq(schema.starboardSettings.guildId, guildId))
				.limit(1)
				.then((rows) => rows[0]);
			return ok(row ?? null);
		}

		if (sub === 'starboard' && method === 'PATCH') {
			const body = await parseBody<Partial<typeof schema.starboardSettings.$inferInsert>>();
			if (!body) return err('Invalid JSON body');
			await db
				.insert(schema.starboardSettings)
				.values(sanitizeGuildPatch(body as Record<string, unknown>, guildId) as any)
				.onDuplicateKeyUpdate({
					set: sanitizeGuildPatch(body as Record<string, unknown>, guildId) as any,
				});
			const updated = await db
				.select()
				.from(schema.starboardSettings)
				.where(eq(schema.starboardSettings.guildId, guildId))
				.limit(1)
				.then((rows) => rows[0]);
			return ok(updated);
		}

		// ── Counting ──────────────────────────────────────────────────────────────
		if (sub === 'counting' && method === 'GET') {
			const row = await db
				.select()
				.from(schema.countingSettings)
				.where(eq(schema.countingSettings.guildId, guildId))
				.limit(1)
				.then((rows) => rows[0]);
			return ok(row ?? null);
		}

		if (sub === 'counting' && method === 'PATCH') {
			const body = await parseBody<Partial<typeof schema.countingSettings.$inferInsert>>();
			if (!body) return err('Invalid JSON body');
			await db
				.insert(schema.countingSettings)
				.values(sanitizeGuildPatch(body as Record<string, unknown>, guildId) as any)
				.onDuplicateKeyUpdate({
					set: sanitizeGuildPatch(body as Record<string, unknown>, guildId) as any,
				});
			const updated = await db
				.select()
				.from(schema.countingSettings)
				.where(eq(schema.countingSettings.guildId, guildId))
				.limit(1)
				.then((rows) => rows[0]);
			return ok(updated);
		}

		// ── Suggestions ───────────────────────────────────────────────────────────
		if (sub === 'suggestions' && method === 'GET') {
			const row = await db
				.select()
				.from(schema.suggestionSettings)
				.where(eq(schema.suggestionSettings.guildId, guildId))
				.limit(1)
				.then((rows) => rows[0]);
			return ok(row ?? null);
		}

		if (sub === 'suggestions' && method === 'PATCH') {
			const body = await parseBody<Partial<typeof schema.suggestionSettings.$inferInsert>>();
			if (!body) return err('Invalid JSON body');
			await db
				.insert(schema.suggestionSettings)
				.values(sanitizeGuildPatch(body as Record<string, unknown>, guildId) as any)
				.onDuplicateKeyUpdate({
					set: sanitizeGuildPatch(body as Record<string, unknown>, guildId) as any,
				});
			const updated = await db
				.select()
				.from(schema.suggestionSettings)
				.where(eq(schema.suggestionSettings.guildId, guildId))
				.limit(1)
				.then((rows) => rows[0]);
			return ok(updated);
		}

		// ── Birthdays ─────────────────────────────────────────────────────────────
		if (sub === 'birthdays' && method === 'GET') {
			const row = await db
				.select()
				.from(schema.birthdaySettings)
				.where(eq(schema.birthdaySettings.guildId, guildId))
				.limit(1)
				.then((rows) => rows[0]);
			return ok(row ?? null);
		}

		if (sub === 'birthdays' && method === 'PATCH') {
			const body = await parseBody<Partial<typeof schema.birthdaySettings.$inferInsert>>();
			if (!body) return err('Invalid JSON body');
			await db
				.insert(schema.birthdaySettings)
				.values(sanitizeGuildPatch(body as Record<string, unknown>, guildId) as any)
				.onDuplicateKeyUpdate({
					set: sanitizeGuildPatch(body as Record<string, unknown>, guildId) as any,
				});
			const updated = await db
				.select()
				.from(schema.birthdaySettings)
				.where(eq(schema.birthdaySettings.guildId, guildId))
				.limit(1)
				.then((rows) => rows[0]);
			return ok(updated);
		}

		// ── Tags ──────────────────────────────────────────────────────────────────
		if (sub === 'tags' && method === 'GET') {
			const allTags = await db
				.select()
				.from(schema.tags)
				.where(eq(schema.tags.guildId, guildId))
				.orderBy(asc(schema.tags.name));
			return ok(allTags);
		}

		if (sub === 'tags' && method === 'POST') {
			const body = await parseBody<{ name: string; aliases?: string[]; content: string; embedJson?: string }>();
			if (!body?.name || !body.content) return err('Missing name or content');
			const aliases = body.aliases ? toStringArrayJson(body.aliases) : '[]';
			if (aliases === null) return err('aliases must be an array of strings');
			if (body.embedJson != null && !isJsonObjectText(body.embedJson)) {
				return err('embedJson must be a JSON object string');
			}
			const [idRow] = await db
				.insert(schema.tags)
				.values({
					guildId,
					name: body.name,
					aliases,
					content: body.content,
					embed: body.embedJson ?? null,
				})
				.$returningId();
			const inserted = await db
				.select()
				.from(schema.tags)
				.where(eq(schema.tags.id, idRow.id))
				.limit(1)
				.then((rows) => rows[0]);
			return ok(inserted);
		}

		if (sub.startsWith('tags/') && method === 'PATCH') {
			const name = decodePathSegment(sub.slice('tags/'.length));
			if (name === null) return err('Invalid tag name');
			if (!name) return err('Missing tag name');
			const body = await parseBody<{ content?: string; aliases?: string[] }>();
			if (!body) return err('Invalid JSON body');
			const set: Partial<typeof schema.tags.$inferInsert> = {};
			if (body.content !== undefined) set.content = body.content;
			if (body.aliases !== undefined) {
				const aliases = toStringArrayJson(body.aliases);
				if (aliases === null) return err('aliases must be an array of strings');
				set.aliases = aliases;
			}
			if (Object.keys(set).length === 0) return err('No valid fields');
			await db
				.update(schema.tags)
				.set(set)
				.where(and(eq(schema.tags.guildId, guildId), eq(schema.tags.name, name)));
			const updated = await db
				.select()
				.from(schema.tags)
				.where(and(eq(schema.tags.guildId, guildId), eq(schema.tags.name, name)))
				.limit(1)
				.then((rows) => rows[0]);
			return ok(updated);
		}

		if (sub.startsWith('tags/') && method === 'DELETE') {
			const name = decodePathSegment(sub.slice('tags/'.length));
			if (name === null) return err('Invalid tag name');
			if (!name) return err('Missing tag name');
			await db.delete(schema.tags).where(and(eq(schema.tags.guildId, guildId), eq(schema.tags.name, name)));
			return ok();
		}

		return err('Not found', 404);
	} catch (e) {
		// Unique-index violations (duplicate filter word, level role, feed, …) are client conflicts, not server errors.
		if (isDuplicateKeyError(e)) return err('An entry with those values already exists', 409);
		container.logger.error('[GuildConfigApi] error:', e);
		return err('Internal error', 500);
	}
}
