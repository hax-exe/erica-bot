import { eq, getTableColumns, sql } from 'drizzle-orm';
import { db, schema } from './database.js';

export const MODULES = [
	'leveling',
	'welcomer',
	'starboard',
	'birthdays',
	'spaces',
	'sticky',
	'tickets',
	'tags',
	'logging',
	'music',
	'reactionRoles',
	'reports',
	'reviews',
	'automod',
	'suggestions',
	'fun',
	'giveaways',
	'economy',
	'tts',
	'autoresponder',
	'verification',
	'rolePersistence',
	'inviteTracking',
	'highlights',
] as const;

export type Module = (typeof MODULES)[number];

export const MODULE_LABELS: Record<Module, string> = {
	leveling: 'Leveling & XP',
	welcomer: 'Welcome / Leave Messages',
	starboard: 'Starboard',
	birthdays: 'Birthday Announcements',
	spaces: 'Temporary Voice Channels',
	sticky: 'Sticky Messages',
	tickets: 'Support Tickets',
	tags: 'Tags',
	logging: 'Audit Logging',
	music: 'Music',
	reactionRoles: 'Reaction Roles',
	reports: 'Reports',
	reviews: 'Ticket Reviews',
	automod: 'AutoMod',
	suggestions: 'Suggestions',
	fun: 'Fun & Games',
	giveaways: 'Giveaways',
	economy: 'Economy',
	tts: 'Text-to-Speech (TTS)',
	autoresponder: 'Autoresponder',
	verification: 'Member Verification',
	rolePersistence: 'Role Persistence',
	inviteTracking: 'Invite Tracking',
	highlights: 'Highlights',
};

type ModuleRow = typeof schema.guildModules.$inferSelect;
type GlobalModuleRow = typeof schema.globalModules.$inferSelect;

/**
 * What a guild without a guild_modules row gets — the column defaults, so creating the row
 * (e.g. by viewing /module list) never changes behaviour. AutoMod, Member Verification and
 * Role Persistence are opt-in (default false).
 */
const GUILD_MODULE_DEFAULTS = Object.fromEntries(
	MODULES.map((m) => [m, getTableColumns(schema.guildModules)[m].default !== false]),
) as Record<Module, boolean>;

// ─── Module row cache ──────────────────────────────────────────────────────────
// isModuleEnabled runs ~25 times per guild message, so the global and per-guild rows
// are cached briefly. Anything that writes guild_modules / global_modules must call
// invalidateModuleCache() afterwards.

const MODULE_CACHE_TTL_MS = 30_000;
const GLOBAL_ROW_KEY = 'global';

const rowCache = new Map<string, { value: unknown; expires: number }>();
/** Shared in-flight reads so a burst of checks on a cold cache costs one query per row. */
const rowReads = new Map<string, Promise<unknown>>();
/** Bumped by every invalidation so a read that started before a write never repopulates the cache. */
let cacheGeneration = 0;

function guildRowKey(guildId: string): string {
	return `guild:${guildId}`;
}

function cachedRow<T>(key: string, load: () => Promise<T>): Promise<T> {
	const hit = rowCache.get(key);
	if (hit && hit.expires > Date.now()) return Promise.resolve(hit.value as T);

	const inflight = rowReads.get(key);
	if (inflight) return inflight as Promise<T>;

	const generation = cacheGeneration;
	const read: Promise<T> = load()
		.then((value) => {
			if (generation === cacheGeneration) rowCache.set(key, { value, expires: Date.now() + MODULE_CACHE_TTL_MS });
			return value;
		})
		.finally(() => {
			if (rowReads.get(key) === read) rowReads.delete(key);
		});
	rowReads.set(key, read);
	return read;
}

/**
 * Drop cached module rows after a write. With a guild ID only that guild's row is dropped;
 * with no argument everything is cleared, including the global row.
 */
export function invalidateModuleCache(guildId?: string): void {
	cacheGeneration++;
	if (guildId === undefined) {
		rowCache.clear();
		rowReads.clear();
		return;
	}
	rowCache.delete(guildRowKey(guildId));
	rowReads.delete(guildRowKey(guildId));
}

export async function getOrCreateModules(guildId: string): Promise<ModuleRow> {
	const existing = await db.query.guildModules.findFirst({
		where: eq(schema.guildModules.guildId, guildId),
	});
	if (existing) return existing;

	// No-op upsert: a concurrent first call may insert the row between the select and this insert.
	await db
		.insert(schema.guildModules)
		.values({ guildId })
		.onDuplicateKeyUpdate({ set: { guildId: sql`${schema.guildModules.guildId}` } });
	invalidateModuleCache(guildId);
	const [row] = await db.select().from(schema.guildModules).where(eq(schema.guildModules.guildId, guildId)).limit(1);
	return row!;
}

/** Get (or initialise) the singleton global modules row. */
export async function getGlobalModules(): Promise<GlobalModuleRow> {
	const existing = await db.query.globalModules.findFirst({
		where: eq(schema.globalModules.id, 1),
	});
	if (existing) return existing;

	await db
		.insert(schema.globalModules)
		.values({ id: 1 })
		.onDuplicateKeyUpdate({ set: { id: sql`${schema.globalModules.id}` } });
	invalidateModuleCache();
	const [row] = await db.select().from(schema.globalModules).where(eq(schema.globalModules.id, 1)).limit(1);
	return row!;
}

/**
 * Returns whether a module is enabled for a guild.
 * Global override takes priority — if globally disabled, always returns false.
 * Falls back to the guild_modules column default if no guild row exists.
 */
export async function isModuleEnabled(guildId: string, module: Module): Promise<boolean> {
	const [globalRow, guildRow] = await Promise.all([
		cachedRow<GlobalModuleRow | null>(
			GLOBAL_ROW_KEY,
			async () => (await db.query.globalModules.findFirst({ where: eq(schema.globalModules.id, 1) })) ?? null,
		),
		cachedRow<ModuleRow | null>(
			guildRowKey(guildId),
			async () => (await db.query.guildModules.findFirst({ where: eq(schema.guildModules.guildId, guildId) })) ?? null,
		),
	]);

	// Global kill-switch: if explicitly false, disable everywhere
	if (globalRow && globalRow[module] === false) return false;

	// Per-guild setting (column default if no row)
	return guildRow?.[module] ?? GUILD_MODULE_DEFAULTS[module];
}

/** Enable or disable a module for a specific guild. */
export async function setModule(guildId: string, module: Module, enabled: boolean): Promise<void> {
	await db
		.insert(schema.guildModules)
		.values({ guildId, [module]: enabled })
		.onDuplicateKeyUpdate({
			set: { [module]: enabled },
		});
	invalidateModuleCache(guildId);
}

/** Enable or disable a module globally (overrides all per-guild settings when false). */
export async function setGlobalModule(module: Module, enabled: boolean): Promise<void> {
	await db
		.insert(schema.globalModules)
		.values({ id: 1, [module]: enabled })
		.onDuplicateKeyUpdate({
			set: { [module]: enabled },
		});
	invalidateModuleCache();
}
