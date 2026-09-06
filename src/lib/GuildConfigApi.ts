import { container } from '@sapphire/framework';
import { ChannelType } from 'discord.js';
import { and, asc, count, desc, eq } from 'drizzle-orm';
import { db, schema } from './database.js';
import { resolveBlueskyHandle, resolveRssFeed } from './FeedPoller.js';

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
			const guild = await container.client.guilds.fetch(guildId);

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
			const guild = await container.client.guilds.fetch({ guild: guildId, force: true });
			const channels = guild.channels.cache
				.filter((c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement)
				.map((c) => ({ id: c.id, name: (c as { name: string }).name, type: c.type }))
				.sort((a, b) => a.name.localeCompare(b.name));
			return ok(channels);
		}

		// ── Roles ─────────────────────────────────────────────────────────────────
		if (sub === 'roles' && method === 'GET') {
			const guild = await container.client.guilds.fetch({ guild: guildId, force: true });
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
					verification: true,
					automod: false,
					suggestions: true,
					fun: true,
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
			const body = await parseBody<SettingsPatch>();
			if (!body) return err('Invalid JSON body');

			const set: Partial<typeof schema.guilds.$inferInsert> = {};

			if (body.logChannelId) {
				const channel = await container.client.channels.fetch(body.logChannelId);
				if (!channel || !('guildId' in channel) || channel.guildId !== guildId) {
					return err('Log channel must belong to the configured guild');
				}
				if (channel && 'createWebhook' in channel && typeof channel.createWebhook === 'function') {
					const webhook = await (
						channel as { createWebhook: (opts: { name: string }) => Promise<{ url: string }> }
					).createWebhook({ name: 'Erica — Logs' });
					set.logWebhookUrl = webhook.url;
				}
			}
			if (body.modLogChannelId) {
				const channel = await container.client.channels.fetch(body.modLogChannelId);
				if (!channel || !('guildId' in channel) || channel.guildId !== guildId) {
					return err('Moderation log channel must belong to the configured guild');
				}
				if (channel && 'createWebhook' in channel && typeof channel.createWebhook === 'function') {
					const webhook = await (
						channel as { createWebhook: (opts: { name: string }) => Promise<{ url: string }> }
					).createWebhook({ name: 'Erica — Moderation Logs' });
					set.modLogWebhookUrl = webhook.url;
				}
			}
			if (body.ticketLogChannelId) {
				const channel = await container.client.channels.fetch(body.ticketLogChannelId);
				if (!channel || !('guildId' in channel) || channel.guildId !== guildId) {
					return err('Ticket log channel must belong to the configured guild');
				}
				if (channel && 'createWebhook' in channel && typeof channel.createWebhook === 'function') {
					const webhook = await (
						channel as { createWebhook: (opts: { name: string }) => Promise<{ url: string }> }
					).createWebhook({ name: 'Erica — Ticket Logs' });
					set.ticketLogWebhookUrl = webhook.url;
				}
			}
			if (body.reportChannelId) {
				const channel = await container.client.channels.fetch(body.reportChannelId);
				if (!channel || !('guildId' in channel) || channel.guildId !== guildId) {
					return err('Report channel must belong to the configured guild');
				}
				if (channel && 'createWebhook' in channel && typeof channel.createWebhook === 'function') {
					const webhook = await (
						channel as { createWebhook: (opts: { name: string }) => Promise<{ url: string }> }
					).createWebhook({ name: 'Erica — Report Logs' });
					set.reportWebhookUrl = webhook.url;
				}
			}
			if (body.clearLog) set.logWebhookUrl = null;
			if (body.clearModLog) set.modLogWebhookUrl = null;
			if (body.clearTicketLog) set.ticketLogWebhookUrl = null;
			if (body.clearReport) set.reportWebhookUrl = null;
			if (body.logIgnoredChannelIds !== undefined) {
				set.logIgnoredChannelIds = JSON.stringify(body.logIgnoredChannelIds);
			}

			await db
				.insert(schema.guilds)
				.values({ id: guildId, ...set })
				.onDuplicateKeyUpdate({ set });

			const updated = await db
				.select()
				.from(schema.guilds)
				.where(eq(schema.guilds.id, guildId))
				.limit(1)
				.then((rows) => rows[0]);
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
			await db
				.insert(schema.automodSettings)
				.values(sanitizeGuildPatch(body as Record<string, unknown>, guildId) as any)
				.onDuplicateKeyUpdate({
					set: sanitizeGuildPatch(body as Record<string, unknown>, guildId) as any,
				});
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
			await db
				.insert(schema.levelSettings)
				.values(sanitizeGuildPatch(body as Record<string, unknown>, guildId) as any)
				.onDuplicateKeyUpdate({
					set: sanitizeGuildPatch(body as Record<string, unknown>, guildId) as any,
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
			const [idRow] = await db
				.insert(schema.tags)
				.values({
					guildId,
					name: body.name,
					aliases: body.aliases ? JSON.stringify(body.aliases) : '[]',
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
			const name = sub.slice('tags/'.length);
			if (!name) return err('Missing tag name');
			const body = await parseBody<{ content?: string; aliases?: string[] }>();
			if (!body) return err('Invalid JSON body');
			const set: Partial<typeof schema.tags.$inferInsert> = {};
			if (body.content !== undefined) set.content = body.content;
			if (body.aliases !== undefined) set.aliases = JSON.stringify(body.aliases);
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
			const name = sub.slice('tags/'.length);
			if (!name) return err('Missing tag name');
			await db.delete(schema.tags).where(and(eq(schema.tags.guildId, guildId), eq(schema.tags.name, name)));
			return ok();
		}

		return err('Not found', 404);
	} catch (e) {
		container.logger.error('[GuildConfigApi] error:', e);
		return err('Internal error', 500);
	}
}
