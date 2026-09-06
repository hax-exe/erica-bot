import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { container } from '@sapphire/framework';
import { z } from 'zod';
import { minecraftLinks } from '../db/schema.js';
import { db } from './database.js';
import { handleGuildRoute } from './GuildConfigApi.js';
import {
	getActiveIncidents,
	getAllServices,
	getHistory,
	getLatestStatus,
	getMaintenance,
	getServiceOverrides,
	getStatusConfig,
	getUptime,
} from './StatusUtil.js';
import { consumeVerification, lookupVerificationCode } from './VerificationUtil.js';

const RANK_PRIORITY = [
	'leadership',
	'admin',
	'community_manager',
	'developer',
	'senior_moderator',
	'moderator',
	'jr_moderator',
	'helper',
	'builder',
] as const;

export type PortalRank =
	| 'member'
	| 'builder'
	| 'helper'
	| 'jr_moderator'
	| 'moderator'
	| 'senior_moderator'
	| 'developer'
	| 'community_manager'
	| 'admin'
	| 'leadership';

const ALLOWED_ROLE_IDS = [
	process.env.DISCORD_ROLE_COMMUNITY_MANAGER,
	process.env.DISCORD_ROLE_DEVELOPER,
	process.env.DISCORD_ROLE_SENIOR_MODERATOR,
	process.env.DISCORD_ROLE_MODERATOR,
	process.env.DISCORD_ROLE_JR_MODERATOR,
	process.env.DISCORD_ROLE_HELPER,
	process.env.DISCORD_ROLE_BUILDER,
	process.env.VERIFIED_ROLE_ID,
].filter((id): id is string => typeof id === 'string' && id.trim().length > 0);

function safeCompare(a: string, b: string): boolean {
	if (typeof a !== 'string' || typeof b !== 'string') return false;
	const aHash = crypto.createHash('sha256').update(a).digest();
	const bHash = crypto.createHash('sha256').update(b).digest();
	return crypto.timingSafeEqual(aHash, bHash);
}

class TokenBucketLimiter {
	private buckets = new Map<string, { tokens: number; lastRefill: number }>();

	constructor(
		private maxTokens: number,
		private refillRatePerMs: number,
	) {}

	public limit(key: string): boolean {
		const now = Date.now();
		let bucket = this.buckets.get(key);

		if (!bucket) {
			bucket = { tokens: this.maxTokens, lastRefill: now };
			this.buckets.set(key, bucket);
		} else {
			const elapsed = now - bucket.lastRefill;
			bucket.tokens = Math.min(this.maxTokens, bucket.tokens + elapsed * this.refillRatePerMs);
			bucket.lastRefill = now;
		}

		if (bucket.tokens >= 1) {
			bucket.tokens -= 1;
			return false; // Not limited
		}
		return true; // Limited
	}
}

const publicRateLimiter = new TokenBucketLimiter(60, 1 / 1000);
const authBruteForceLimiter = new TokenBucketLimiter(10, 1 / 6000);

function getClientIp(req: Request, server: any): string {
	const cfIp = req.headers.get('CF-Connecting-IP');
	if (cfIp) return cfIp;

	const xff = req.headers.get('X-Forwarded-For');
	if (xff) {
		const first = xff.split(',')[0].trim();
		if (first) return first;
	}

	return server?.requestIP(req)?.address ?? 'unknown';
}

const assignVerifiedSchema = z.object({
	discordId: z.string().regex(/^\d{17,20}$/, 'Invalid Discord ID'),
});

const verifySchema = z.object({
	code: z.string().min(1),
	username: z.string().min(1).max(16),
	uuid: z.string().uuid().nullable().optional(),
});

const setRolesSchema = z.object({
	discordId: z.string().regex(/^\d{17,20}$/, 'Invalid Discord ID'),
	addRoleIds: z.array(z.string().regex(/^\d{17,20}$/)).optional(),
	removeRoleIds: z.array(z.string().regex(/^\d{17,20}$/)).optional(),
});

const sendDmSchema = z.object({
	discordId: z.string().regex(/^\d{17,20}$/, 'Invalid Discord ID'),
	content: z.string().max(2000).optional(),
	embed: z.record(z.string(), z.any()).optional(),
});

/** Resolve the highest website rank + full roles array from a member's Discord role IDs. */
export function resolveRank(memberRoleIds: Set<string>): { rank: PortalRank; roles: string } {
	const matched: PortalRank[] = [];

	for (const rank of RANK_PRIORITY) {
		const roleId = process.env[`DISCORD_ROLE_${rank.toUpperCase()}`];
		if (roleId && memberRoleIds.has(roleId)) matched.push(rank);
	}

	matched.push('member');
	return { rank: matched[0], roles: JSON.stringify(matched) };
}

/**
 * Update the portal profile to mark a user as verified and sync their rank.
 * Calls the portal's /api/mc/sync-verified endpoint — no D1 credentials needed.
 * Soft-fails — logs a warning but never throws.
 */
export async function syncPortalProfile(
	discordUserId: string,
	minecraftUsername: string,
	minecraftUuid: string | null,
	rank: PortalRank,
	roles: string,
): Promise<void> {
	const portalApiUrl = process.env.PORTAL_API_URL?.trim();
	const botApiSecret = process.env.BOT_API_SECRET?.trim();

	container.logger.info(
		`[PortalSync] starting sync for Discord user ${discordUserId} (mc: ${minecraftUsername}, uuid: ${minecraftUuid}, rank: ${rank})`,
	);
	container.logger.info(`[PortalSync] PORTAL_API_URL: ${portalApiUrl ?? '(not set)'}`);
	container.logger.info(`[PortalSync] BOT_API_SECRET configured: ${!!botApiSecret}`);

	if (!portalApiUrl || !botApiSecret) {
		container.logger.warn('[PortalSync] PORTAL_API_URL or BOT_API_SECRET not set — skipping portal sync.');
		return;
	}

	const url = `${portalApiUrl}/api/mc/sync-verified`;
	container.logger.info(`[PortalSync] POST ${url}`);

	try {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-Bot-Secret': botApiSecret },
			body: JSON.stringify({ discordId: discordUserId, minecraftUsername, minecraftUuid, rank, roles }),
		});

		const responseText = await res.text().catch(() => '');
		container.logger.info(`[PortalSync] response status: ${res.status}`);
		container.logger.info(`[PortalSync] response body: ${responseText}`);

		if (res.status === 404) {
			container.logger.warn(`[PortalSync] Discord user ${discordUserId} has no portal account.`);
			return;
		}
		if (!res.ok) {
			container.logger.warn(`[PortalSync] sync-verified failed — ${res.status}: ${responseText}`);
			return;
		}

		container.logger.info(`[PortalSync] successfully synced portal profile for Discord user ${discordUserId}`);
	} catch (err) {
		container.logger.warn('[PortalSync] fetch threw an error:', err);
	}
}

export function startApiServer(options: { fullApiEnabled?: boolean } = {}): ReturnType<typeof Bun.serve> {
	const port = Number(process.env.BOT_API_PORT ?? 3001);
	const token = process.env.BOT_API_SECRET?.trim() ?? '';
	const fullApiRequested = options.fullApiEnabled === true;
	const fullApiEnabled = fullApiRequested && token.length > 0;
	const supportGuildId = process.env.SUPPORT_GUILD_ID;
	const teamRoleId = process.env.TEAM_ROLE_ID;
	const verificationGuildId = process.env.VERIFICATION_GUILD_ID;
	const verifiedRoleId = process.env.VERIFIED_ROLE_ID;

	if (fullApiRequested && !token) {
		container.logger.warn('[API] BOT_API_SECRET is not set — private API disabled; health endpoint remains online.');
	}

	const ALLOWED_ORIGINS = ['https://aloramc.com', 'https://www.aloramc.com'];

	function corsHeaders(req: Request): Record<string, string> {
		const origin = req.headers.get('Origin') ?? '';
		const allowed =
			ALLOWED_ORIGINS.includes(origin) || /^https?:\/\/localhost(:\d+)?$/.test(origin) ? origin : ALLOWED_ORIGINS[0];
		return {
			'Access-Control-Allow-Origin': allowed,
			'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Bot-Secret',
		};
	}

	const server = Bun.serve({
		port,
		async fetch(req, server) {
			const url = new URL(req.url);
			container.logger.info(`[API] ${req.method} ${url.pathname}`);

			// ── CORS preflight ────────────────────────────────────────────────────
			if (req.method === 'OPTIONS') {
				return new Response(null, { status: 204, headers: corsHeaders(req) });
			}

			const clientIp = getClientIp(req, server);
			const isPublicRoute =
				url.pathname === '/api/health' || url.pathname === '/api/status' || url.pathname === '/api/team';

			if (isPublicRoute) {
				if (publicRateLimiter.limit(clientIp)) {
					container.logger.warn(`[API] 429 — Public rate limit exceeded for IP ${clientIp}`);
					return Response.json({ error: 'Too many requests' }, { status: 429 });
				}
			}

			const res = await routeRequest(req, url, clientIp);
			const cors = corsHeaders(req);
			for (const [k, v] of Object.entries(cors)) res.headers.set(k, v as string);

			res.headers.set('X-Content-Type-Options', 'nosniff');
			res.headers.set('X-Frame-Options', 'DENY');
			res.headers.set('Referrer-Policy', 'no-referrer');
			res.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');

			return res;
		},

		error(err) {
			container.logger.error('[API] unhandled server error:', err);
			return Response.json({ error: 'Internal server error' }, { status: 500 });
		},
	});

	container.logger.info(`[API] HTTP server listening on port ${port} (${fullApiEnabled ? 'full API' : 'health-only'})`);
	return server;

	// ── Route handler (inner function — hoisted, so safe to reference above) ─────

	async function routeRequest(req: Request, url: URL, clientIp: string): Promise<Response> {
		// ── Health ────────────────────────────────────────────────────────────
		if (url.pathname === '/api/health') {
			return Response.json({
				ok: true,
				service: 'erica',
				api: fullApiEnabled ? 'full' : 'health-only',
				timestamp: new Date().toISOString(),
				uptime: Math.floor(process.uptime()),
			});
		}

		// ── Status (public) ───────────────────────────────────────────────────
		if (url.pathname === '/api/status') {
			const daysParam = Number(url.searchParams.get('days') ?? 14);
			const days = Number.isFinite(daysParam) ? Math.min(Math.max(daysParam, 1), 30) : 14;

			const config = getStatusConfig();
			const services = getAllServices();

			const [statuses, uptimes, histories, maintenance, overrides, activeIncidents] = await Promise.all([
				Promise.all(services.map(async (s) => ({ id: s.id, ...(await getLatestStatus(s.id)) }))),
				Promise.all(services.map(async (s) => ({ id: s.id, uptime: await getUptime(s.id) }))),
				Promise.all(services.map(async (s) => ({ id: s.id, history: await getHistory(s.id, days) }))),
				getMaintenance(),
				getServiceOverrides(),
				getActiveIncidents(),
			]);

			const latestMap = new Map(statuses.map((s) => [s.id, { online: s.online, pingMs: s.pingMs }]));
			const uptimeMap = new Map(uptimes.map((u) => [u.id, u.uptime]));
			const historyMap = new Map(histories.map((h) => [h.id, h.history]));

			const result = config.categories.map((cat) => ({
				id: cat.id,
				label: cat.label,
				services: cat.services.map((svc) => {
					const override = overrides.get(svc.id);
					const latest = latestMap.get(svc.id);
					const status = override?.status ?? (latest?.online ? 'online' : latest?.online === false ? 'offline' : null);
					return {
						id: svc.id,
						label: svc.label,
						status,
						online: status === 'online',
						pingMs: latest?.pingMs ?? null,
						uptime30d: uptimeMap.get(svc.id) ?? null,
						history: historyMap.get(svc.id) ?? [],
						override: override ? { status: override.status, reason: override.reason } : null,
					};
				}),
			}));

			const maintenanceUpdates = maintenance?.updates
				? (JSON.parse(maintenance.updates) as { message: string; at: string }[])
				: [];

			const incidentsOut = activeIncidents.map((i) => ({
				id: i.id,
				title: i.title,
				status: i.status,
				severity: i.severity,
				startedAt: i.startedAt,
				updates: i.updates ? JSON.parse(i.updates) : [],
			}));

			return Response.json({
				timestamp: new Date().toISOString(),
				historyDays: days,
				maintenance: {
					enabled: maintenance?.enabled ?? false,
					reason: maintenance?.reason ?? null,
					startedAt: maintenance?.startedAt ?? null,
					updates: maintenanceUpdates,
				},
				incidents: incidentsOut,
				categories: result,
			});
		}

		// ── Team (public) ─────────────────────────────────────────────────────
		if (url.pathname === '/api/team') {
			container.logger.info(
				`[API /team] SUPPORT_GUILD_ID=${supportGuildId ?? '(not set)'} TEAM_ROLE_ID=${teamRoleId ?? '(not set)'}`,
			);
			if (!supportGuildId || !teamRoleId) {
				container.logger.warn('[API /team] missing SUPPORT_GUILD_ID or TEAM_ROLE_ID');
				return Response.json(
					{ error: 'SUPPORT_GUILD_ID or TEAM_ROLE_ID is not configured on the server.' },
					{ status: 500 },
				);
			}

			const guild = await container.client.guilds.fetch(supportGuildId).catch((err) => {
				container.logger.warn('[API /team] failed to fetch guild:', err);
				return null;
			});
			if (!guild) {
				container.logger.warn('[API /team] guild not found');
				return Response.json({ error: 'Support guild not found or bot is not in it.' }, { status: 503 });
			}

			const members = await guild.members.fetch().catch((err) => {
				container.logger.warn('[API /team] failed to fetch members:', err);
				return null;
			});
			if (!members) {
				return Response.json({ error: 'Could not fetch guild members.' }, { status: 503 });
			}

			const teamMembers = members.filter((m) => m.roles.cache.has(teamRoleId));
			container.logger.info(`[API /team] total members=${members.size} team members=${teamMembers.size}`);

			const links = await db.select().from(minecraftLinks);
			const linkMap = new Map(links.map((l) => [l.userId, l.minecraftName]));
			container.logger.info(`[API /team] minecraft links loaded: ${links.length}`);

			const result = teamMembers.map((m) => ({
				id: m.id,
				username: m.user.username,
				displayName: m.displayName,
				roles: m.roles.cache
					.filter((r) => r.id !== guild.id)
					.sort((a, b) => b.position - a.position)
					.map((r) => ({ id: r.id, name: r.name })),
				minecraftName: linkMap.get(m.id) ?? null,
			}));

			container.logger.info(`[API /team] returning ${result.length} members`);
			return Response.json(result);
		}

		// Public health/status/team routes stay available while private integrations are disabled.
		if (!fullApiEnabled) {
			return Response.json({ error: 'Private API is disabled', health: '/api/health' }, { status: 503 });
		}

		// ── Auth ──────────────────────────────────────────────────────────────
		const secret = req.headers.get('X-Bot-Secret') ?? '';
		const bearer = req.headers.get('Authorization') ?? '';
		const authed = safeCompare(secret, token) || safeCompare(bearer, `Bearer ${token}`);
		container.logger.info(
			`[API] auth check for ${url.pathname} — X-Bot-Secret: ${!!secret} | Bearer: ${!!bearer} | authed: ${authed}`,
		);
		if (!authed) {
			if (authBruteForceLimiter.limit(clientIp)) {
				container.logger.warn(`[API] 429 — Auth rate limit exceeded for IP ${clientIp}`);
				return Response.json({ error: 'Too many requests' }, { status: 429 });
			}
			container.logger.warn(`[API] 401 — unauthorized request to ${url.pathname}`);
			return Response.json({ error: 'Unauthorized' }, { status: 401 });
		}

		// ── Transcripts (HTML preferred, TXT fallback) ─────────────────────────
		if (url.pathname.startsWith('/api/transcripts/') && req.method === 'GET') {
			const code = url.pathname.slice('/api/transcripts/'.length).split('/')[0]?.trim() ?? '';
			if (!/^[a-zA-Z0-9_-]{4,64}$/.test(code)) {
				return Response.json({ error: 'Invalid transcript code' }, { status: 400 });
			}
			const dir = path.join(process.cwd(), 'data', 'transcripts');
			const htmlPath = path.join(dir, `${code}.html`);
			const txtPath = path.join(dir, `${code}.txt`);
			try {
				if (existsSync(htmlPath)) {
					const body = await readFile(htmlPath, 'utf8');
					return new Response(body, {
						status: 200,
						headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, max-age=3600' },
					});
				}
				if (existsSync(txtPath)) {
					const body = await readFile(txtPath, 'utf8');
					return new Response(body, {
						status: 200,
						headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, max-age=3600' },
					});
				}
				return Response.json({ error: 'Transcript not found' }, { status: 404 });
			} catch (err) {
				container.logger.error('[API /transcripts] read failed:', err);
				return Response.json({ error: 'Failed to read transcript' }, { status: 500 });
			}
		}

		// ── Assign verified role (called by portal after website verification) ─
		// Body: { discordId: string }
		if (url.pathname === '/api/mc/assign-verified' && req.method === 'POST') {
			container.logger.info('[API /mc/assign-verified] received request');
			if (!verificationGuildId || !verifiedRoleId) {
				container.logger.warn('[API /mc/assign-verified] missing VERIFICATION_GUILD_ID or VERIFIED_ROLE_ID');
				return Response.json({ error: 'VERIFICATION_GUILD_ID or VERIFIED_ROLE_ID not configured.' }, { status: 500 });
			}

			let rawBody: unknown;
			try {
				rawBody = await req.json();
			} catch (err) {
				container.logger.warn('[API /mc/assign-verified] invalid JSON:', err);
				return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
			}

			const parsed = assignVerifiedSchema.safeParse(rawBody);
			if (!parsed.success) {
				container.logger.warn('[API /mc/assign-verified] validation failed:', parsed.error.format());
				return Response.json({ error: 'Invalid request payload.', details: parsed.error.format() }, { status: 400 });
			}

			const { discordId } = parsed.data;
			container.logger.info(`[API /mc/assign-verified] discordId=${discordId}`);

			try {
				const guild = await container.client.guilds.fetch(verificationGuildId);
				const member = await guild.members.fetch(discordId).catch(() => null);
				container.logger.info(`[API /mc/assign-verified] member found: ${!!member}`);
				if (!member) return Response.json({ ok: false, reason: 'member_not_found' });
				await member.roles.add(verifiedRoleId, 'Website Minecraft verification');
				container.logger.info(`[API /mc/assign-verified] verified role assigned to ${discordId}`);
				return Response.json({ ok: true, discordId });
			} catch (err) {
				container.logger.error('[API /mc/assign-verified] error:', err);
				return Response.json({ error: 'Failed to assign verified role.' }, { status: 502 });
			}
		}

		// ── MC Verify ─────────────────────────────────────────────────────────
		if (url.pathname === '/api/mc/verify' && req.method === 'POST') {
			if (!verificationGuildId || !verifiedRoleId) {
				return Response.json(
					{ error: 'VERIFICATION_GUILD_ID or VERIFIED_ROLE_ID is not configured on the server.' },
					{ status: 500 },
				);
			}

			let rawBody: unknown;
			try {
				rawBody = await req.json();
			} catch {
				return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
			}

			const parsed = verifySchema.safeParse(rawBody);
			if (!parsed.success) {
				container.logger.warn('[API /mc/verify] validation failed:', parsed.error.format());
				return Response.json({ error: 'Invalid request payload.', details: parsed.error.format() }, { status: 400 });
			}

			const { code, username, uuid = null } = parsed.data;

			container.logger.info(`[API /mc/verify] code=${code} username=${username} uuid=${uuid}`);

			const pending = await lookupVerificationCode(code);
			container.logger.info(
				`[API /mc/verify] code lookup result: ${pending ? `found userId=${pending.userId}` : 'NOT FOUND (invalid/expired)'}`,
			);

			if (!pending) {
				return Response.json({ error: 'Invalid or expired verification code.' }, { status: 404 });
			}

			// Assign the verified Discord role and sync portal profile
			let memberRoleIds = new Set<string>();
			try {
				const guild = await container.client.guilds.fetch(verificationGuildId);
				const member = await guild.members.fetch(pending.userId);
				await member.roles.add(verifiedRoleId, 'Minecraft verification completed');
				memberRoleIds = new Set(member.roles.cache.keys());
				container.logger.info(`[API /mc/verify] verified role assigned to ${pending.userId}`);
			} catch (err) {
				container.logger.warn('[API /mc/verify] could not assign verified role:', err);
				return Response.json(
					{ error: 'Could not assign the verified Discord role. Please try again.' },
					{ status: 502 },
				);
			}

			await db
				.insert(minecraftLinks)
				.values({ userId: pending.userId, minecraftName: username, minecraftUuid: uuid })
				.onDuplicateKeyUpdate({
					set: { minecraftName: username, minecraftUuid: uuid },
				});
			container.logger.info(`[API /mc/verify] minecraft link saved — userId=${pending.userId}`);

			await consumeVerification(pending.userId);
			container.logger.info(`[API /mc/verify] verification code consumed`);

			const resolved = resolveRank(memberRoleIds);

			container.logger.info(`[API /mc/verify] resolved rank=${resolved.rank} roles=${resolved.roles}`);
			container.logger.info(`[API /mc/verify] calling syncPortalProfile...`);

			await syncPortalProfile(pending.userId, username, uuid, resolved.rank, resolved.roles);

			container.logger.info(`[API /mc/verify] done — returning ok`);
			return Response.json({ ok: true, userId: pending.userId, username });
		}

		// ── Guild member check ────────────────────────────────────────────────
		if (url.pathname.startsWith('/api/guild/member/') && req.method === 'GET') {
			const discordId = url.pathname.slice('/api/guild/member/'.length);
			container.logger.info(
				`[API /guild/member] discordId=${discordId} VERIFICATION_GUILD_ID=${verificationGuildId ?? '(not set)'}`,
			);

			if (!discordId || !verificationGuildId) {
				container.logger.warn('[API /guild/member] missing discordId or VERIFICATION_GUILD_ID');
				return Response.json({ error: 'Missing discordId or VERIFICATION_GUILD_ID not set.' }, { status: 400 });
			}

			try {
				const guild = await container.client.guilds.fetch(verificationGuildId);
				const ban = await guild.bans.fetch(discordId).catch(() => null);
				container.logger.info(`[API /guild/member] banned=${!!ban}`);
				if (ban) return Response.json({ inGuild: false, banned: true });

				const member = await guild.members.fetch(discordId).catch(() => null);
				container.logger.info(`[API /guild/member] inGuild=${!!member}`);
				return Response.json({ inGuild: !!member, banned: false });
			} catch (err) {
				container.logger.warn('[API /guild/member] error:', err);
				return Response.json({ error: 'Failed to check guild membership.' }, { status: 502 });
			}
		}

		// ── Set Discord roles ─────────────────────────────────────────────────
		if (url.pathname === '/api/guild/set-roles' && req.method === 'POST') {
			container.logger.info('[API /guild/set-roles] received request');
			if (!verificationGuildId) {
				container.logger.warn('[API /guild/set-roles] VERIFICATION_GUILD_ID not set');
				return Response.json({ error: 'VERIFICATION_GUILD_ID not configured.' }, { status: 500 });
			}

			let rawBody: unknown;
			try {
				rawBody = await req.json();
			} catch (err) {
				container.logger.warn('[API /guild/set-roles] invalid JSON:', err);
				return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
			}

			const parsed = setRolesSchema.safeParse(rawBody);
			if (!parsed.success) {
				container.logger.warn('[API /guild/set-roles] validation failed:', parsed.error.format());
				return Response.json({ error: 'Invalid request payload.', details: parsed.error.format() }, { status: 400 });
			}

			const { discordId, addRoleIds = [], removeRoleIds = [] } = parsed.data;

			container.logger.info(
				`[API /guild/set-roles] discordId=${discordId} add=${JSON.stringify(addRoleIds)} remove=${JSON.stringify(removeRoleIds)}`,
			);

			// Enforce role assignment whitelist (Least Privilege)
			const invalidAdd = addRoleIds.filter((id) => !ALLOWED_ROLE_IDS.includes(id));
			const invalidRemove = removeRoleIds.filter((id) => !ALLOWED_ROLE_IDS.includes(id));

			if (invalidAdd.length > 0 || invalidRemove.length > 0) {
				container.logger.warn(
					`[API /guild/set-roles] blocked attempt to manage unwhitelisted roles: add=${JSON.stringify(invalidAdd)}, remove=${JSON.stringify(invalidRemove)}`,
				);
				return Response.json({ error: 'Cannot assign or remove unwhitelisted roles via the API.' }, { status: 403 });
			}

			try {
				const guild = await container.client.guilds.fetch(verificationGuildId);
				const member = await guild.members.fetch(discordId).catch(() => null);
				container.logger.info(`[API /guild/set-roles] member found: ${!!member}`);
				if (!member) return Response.json({ ok: false, reason: 'member_not_found' });

				if (addRoleIds.length > 0) await member.roles.add(addRoleIds, 'MC rank sync');
				if (removeRoleIds.length > 0) await member.roles.remove(removeRoleIds, 'MC rank sync');

				container.logger.info(`[API /guild/set-roles] roles updated for ${discordId}`);
				return Response.json({ ok: true, discordId, addRoleIds, removeRoleIds });
			} catch (err) {
				container.logger.warn('[API /guild/set-roles] error:', err);
				return Response.json({ error: 'Failed to update member roles.' }, { status: 502 });
			}
		}

		// ── Send DM ───────────────────────────────────────────────────────────
		if (url.pathname === '/api/dm' && req.method === 'POST') {
			let rawBody: unknown;
			try {
				rawBody = await req.json();
			} catch (err) {
				container.logger.warn('[API /dm] invalid JSON:', err);
				return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
			}

			const parsed = sendDmSchema.safeParse(rawBody);
			if (!parsed.success) {
				container.logger.warn('[API /dm] validation failed:', parsed.error.format());
				return Response.json({ error: 'Invalid request payload.', details: parsed.error.format() }, { status: 400 });
			}

			const { discordId, content, embed } = parsed.data;

			container.logger.info(`[API /dm] discordId=${discordId} hasContent=${!!content} hasEmbed=${!!embed}`);

			try {
				const user = await container.client.users.fetch(discordId);
				container.logger.info(`[API /dm] fetched user: ${user.tag}`);
				const payload: { content?: string; embeds?: object[] } = {};
				if (content) payload.content = content;
				if (embed) payload.embeds = [embed];
				await user.send(payload);
				container.logger.info(`[API /dm] DM sent to ${user.tag} (${discordId})`);
				return Response.json({ ok: true, discordId });
			} catch (err) {
				container.logger.error(`[API /dm] failed to send DM to ${discordId}:`, err);
				return Response.json(
					{ ok: false, reason: 'dm_failed', error: 'Failed to send direct message.' },
					{ status: 502 },
				);
			}
		}

		// ── List all guilds ───────────────────────────────────────────────────
		if (url.pathname === '/api/guilds' && req.method === 'GET') {
			const guilds = container.client.guilds.cache.map((g) => ({
				id: g.id,
				name: g.name,
				icon: g.icon,
				memberCount: g.memberCount,
			}));
			return Response.json(guilds);
		}

		// ── Guild config routes ───────────────────────────────────────────────
		const guildRouteMatch = url.pathname.match(/^\/api\/guilds\/([^/]+)(?:\/(.*))?$/);
		if (guildRouteMatch) {
			const guildId = guildRouteMatch[1];
			const sub = guildRouteMatch[2] ?? '';
			return handleGuildRoute(req, guildId, sub);
		}

		container.logger.warn(`[API] 404 — no handler for ${req.method} ${url.pathname}`);
		return Response.json({ error: 'Not found' }, { status: 404 });
	}
}
