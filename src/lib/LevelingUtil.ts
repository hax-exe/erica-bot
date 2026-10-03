import type { GuildMember } from 'discord.js';
import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import { db, schema } from './database.js';

// ─── XP Formula (MEE6-style) ──────────────────────────────────────────────────

/** XP required to advance through level `n` (i.e. from level n → n+1). */
export function xpForLevel(n: number): number {
	return 5 * n * n + 50 * n + 100;
}

/** Decompose total XP into current level, progress within that level, and XP needed for next. */
export function levelFromTotalXp(totalXp: number): { level: number; currentXp: number; xpNeeded: number } {
	let level = 0;
	let remaining = totalXp;
	while (remaining >= xpForLevel(level)) {
		remaining -= xpForLevel(level);
		level++;
	}
	return { level, currentXp: remaining, xpNeeded: xpForLevel(level) };
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type XpRow = typeof schema.xp.$inferSelect;
export type LevelSettingsRow = typeof schema.levelSettings.$inferSelect;
export type LevelMultiplierRow = typeof schema.levelMultipliers.$inferSelect;
export type LevelMultiplierTargetType = LevelMultiplierRow['targetType'];

export interface TryAddXpResult {
	leveledUp: boolean;
	newLevel: number;
	oldLevel: number;
}

// ─── In-memory XP cooldown ────────────────────────────────────────────────────

const _cooldowns = new Map<string, number>();

// ─── Settings ─────────────────────────────────────────────────────────────────

export async function getLevelSettings(guildId: string): Promise<LevelSettingsRow | null> {
	return db
		.select()
		.from(schema.levelSettings)
		.where(eq(schema.levelSettings.guildId, guildId))
		.limit(1)
		.then((r) => r[0] ?? null);
}

export async function getOrCreateLevelSettings(guildId: string): Promise<LevelSettingsRow> {
	const existing = await getLevelSettings(guildId);
	if (existing) return existing;
	// No-op upsert: a concurrent first call may insert the row between the select and this insert.
	await db
		.insert(schema.levelSettings)
		.values({ guildId })
		.onDuplicateKeyUpdate({ set: { guildId: sql`${schema.levelSettings.guildId}` } });
	const [row] = await db.select().from(schema.levelSettings).where(eq(schema.levelSettings.guildId, guildId)).limit(1);
	return row!;
}

export async function upsertLevelSettings(guildId: string, data: Partial<Omit<LevelSettingsRow, 'guildId'>>) {
	// Single upsert (no select-then-insert race); the no-op guildId keeps the SET clause non-empty.
	await db
		.insert(schema.levelSettings)
		.values({ guildId, ...data })
		.onDuplicateKeyUpdate({ set: { guildId: sql`${schema.levelSettings.guildId}`, ...data } });
}

// ─── XP multipliers and boosts ────────────────────────────────────────────────

/** Combined role x channel x boost factor never exceeds this. */
export const MAX_XP_MULTIPLIER = 5;
/** Allowed percent range for a role or channel multiplier (150 = 1.5x). */
export const MULTIPLIER_PERCENT_MIN = 10;
export const MULTIPLIER_PERCENT_MAX = 500;
/** Allowed percent range for a boost (must actually boost). */
export const BOOST_PERCENT_MIN = 110;
export const BOOST_PERCENT_MAX = 500;
/** Longest boost a staff member can start. */
export const BOOST_MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

const MULTIPLIER_CACHE_TTL_MS = 60_000;

export interface ActiveBoost {
	percent: number;
	endsAt: number;
}

/** A percent is usable when it is a positive finite number; anything else falls back to the neutral 100. */
function usablePercent(percent: number | null | undefined): percent is number {
	return typeof percent === 'number' && Number.isFinite(percent) && percent > 0;
}

/** The boost on a settings row while it is running (`boostEndsAt > now`), otherwise null. */
export function getActiveBoost(
	settings: Pick<LevelSettingsRow, 'boostPercent' | 'boostEndsAt'>,
	now = Date.now(),
): ActiveBoost | null {
	const { boostPercent, boostEndsAt } = settings;
	if (boostEndsAt === null || boostEndsAt === undefined || boostEndsAt <= now) return null;
	if (!usablePercent(boostPercent)) return null;
	return { percent: boostPercent, endsAt: boostEndsAt };
}

export interface MultiplierInputs {
	/** Percent of every multiplier role the member has (roles without a multiplier are left out). */
	rolePercents: readonly number[];
	/** Percent configured for the channel (or, in a thread, its parent channel); null/undefined when none. */
	channelPercent?: number | null;
	boostPercent: number;
	boostEndsAt: number | null;
	now: number;
}

/**
 * Pure: effective XP factor = highest role percent x channel percent x active boost percent (each defaulting
 * to 100), divided out to a factor (150 = 1.5) and capped at {@link MAX_XP_MULTIPLIER}.
 */
export function combineMultipliers(input: MultiplierInputs): number {
	const roles = input.rolePercents.filter(usablePercent);
	const rolePercent = roles.length > 0 ? Math.max(...roles) : 100;
	const channelPercent = usablePercent(input.channelPercent) ? input.channelPercent : 100;
	const boostPercent = getActiveBoost(input, input.now)?.percent ?? 100;
	return Math.min(MAX_XP_MULTIPLIER, (rolePercent * channelPercent * boostPercent) / 1_000_000);
}

interface GuildMultipliers {
	roles: Map<string, number>;
	channels: Map<string, number>;
	expiresAt: number;
}

const _multiplierCache = new Map<string, GuildMultipliers>();
/** Bumped on every invalidation so a load that raced a change never caches its stale rows. */
let _multiplierEpoch = 0;

/** Drop the cached multipliers for a guild. Call after any change to `level_multipliers`. */
export function invalidateMultiplierCache(guildId: string) {
	_multiplierCache.delete(guildId);
	_multiplierEpoch++;
}

async function loadGuildMultipliers(guildId: string): Promise<GuildMultipliers> {
	const cached = _multiplierCache.get(guildId);
	if (cached && cached.expiresAt > Date.now()) return cached;

	const epoch = _multiplierEpoch;
	const rows = await db.select().from(schema.levelMultipliers).where(eq(schema.levelMultipliers.guildId, guildId));
	const entry: GuildMultipliers = {
		roles: new Map(),
		channels: new Map(),
		expiresAt: Date.now() + MULTIPLIER_CACHE_TTL_MS,
	};
	for (const row of rows) {
		(row.targetType === 'role' ? entry.roles : entry.channels).set(row.targetId, row.percent);
	}
	if (epoch === _multiplierEpoch) _multiplierCache.set(guildId, entry);
	return entry;
}

/**
 * Effective XP factor for a member earning XP in `channelId` (a voice channel for voice XP).
 * Pass `parentChannelId` for a thread so the parent channel's multiplier applies when the thread has none.
 * Role and channel multipliers come from a 60 s per-guild cache; the boost is read from `settings`.
 */
export async function getXpMultiplier(
	guildId: string,
	member: GuildMember | null,
	channelId: string,
	settings: Pick<LevelSettingsRow, 'boostPercent' | 'boostEndsAt'>,
	parentChannelId?: string | null,
): Promise<number> {
	const { roles, channels } = await loadGuildMultipliers(guildId);

	const rolePercents: number[] = [];
	if (member && roles.size > 0) {
		for (const [roleId, percent] of roles) {
			if (member.roles.cache.has(roleId)) rolePercents.push(percent);
		}
	}

	return combineMultipliers({
		rolePercents,
		channelPercent: channels.get(channelId) ?? (parentChannelId ? channels.get(parentChannelId) : undefined),
		boostPercent: settings.boostPercent,
		boostEndsAt: settings.boostEndsAt,
		now: Date.now(),
	});
}

export async function listLevelMultipliers(guildId: string): Promise<LevelMultiplierRow[]> {
	return db
		.select()
		.from(schema.levelMultipliers)
		.where(eq(schema.levelMultipliers.guildId, guildId))
		.orderBy(
			asc(schema.levelMultipliers.targetType),
			desc(schema.levelMultipliers.percent),
			asc(schema.levelMultipliers.id),
		);
}

export async function countLevelMultipliers(guildId: string): Promise<number> {
	const [res] = await db
		.select({ n: sql<number>`count(*)` })
		.from(schema.levelMultipliers)
		.where(eq(schema.levelMultipliers.guildId, guildId));
	return Number(res?.n ?? 0);
}

/** Create or update a role/channel multiplier and invalidate the guild's cache. */
export async function setLevelMultiplier(
	guildId: string,
	targetType: LevelMultiplierTargetType,
	targetId: string,
	percent: number,
) {
	await db
		.insert(schema.levelMultipliers)
		.values({ guildId, targetType, targetId, percent })
		.onDuplicateKeyUpdate({ set: { percent } });
	invalidateMultiplierCache(guildId);
}

/** Remove a multiplier. Returns false when none existed for that target. */
export async function removeLevelMultiplier(
	guildId: string,
	targetType: LevelMultiplierTargetType,
	targetId: string,
): Promise<boolean> {
	const result = await db
		.delete(schema.levelMultipliers)
		.where(
			and(
				eq(schema.levelMultipliers.guildId, guildId),
				eq(schema.levelMultipliers.targetType, targetType),
				eq(schema.levelMultipliers.targetId, targetId),
			),
		);
	invalidateMultiplierCache(guildId);
	// mysql2's ResultSetHeader is not exposed through Drizzle's return type.
	return Number((result as any)[0]?.affectedRows ?? 0) > 0;
}

// ─── XP row helpers ───────────────────────────────────────────────────────────

export async function getXpRow(guildId: string, userId: string): Promise<XpRow | null> {
	return db
		.select()
		.from(schema.xp)
		.where(and(eq(schema.xp.guildId, guildId), eq(schema.xp.userId, userId)))
		.limit(1)
		.then((r) => r[0] ?? null);
}

async function getOrCreateXpRow(guildId: string, userId: string): Promise<XpRow> {
	const existing = await getXpRow(guildId, userId);
	if (existing) return existing;
	// No-op upsert: a concurrent first call may insert the row between the select and this insert.
	await db
		.insert(schema.xp)
		.values({ guildId, userId, totalXp: 0, level: 0 })
		.onDuplicateKeyUpdate({ set: { id: sql`${schema.xp.id}` } });
	const [row] = await db
		.select()
		.from(schema.xp)
		.where(and(eq(schema.xp.guildId, guildId), eq(schema.xp.userId, userId)))
		.limit(1);
	return row!;
}

// ─── XP mutations ─────────────────────────────────────────────────────────────

/**
 * Called on each eligible message. Returns null if the user is on cooldown.
 * Mutates the DB and returns level-up info if the user leveled up.
 */
export async function tryAddXp(
	guildId: string,
	userId: string,
	settings: LevelSettingsRow,
	multiplier = 1.0,
): Promise<TryAddXpResult | null> {
	const key = `${guildId}:${userId}`;
	const now = Date.now();
	if (now - (_cooldowns.get(key) ?? 0) < settings.cooldownSeconds * 1000) return null;
	_cooldowns.set(key, now);

	const base = settings.xpMin + Math.floor(Math.random() * (settings.xpMax - settings.xpMin + 1));
	const amount = Math.round(base * multiplier);
	return incrementXp(guildId, userId, amount, { lastMessageAt: now });
}

/**
 * Atomically add `amount` XP (creating the row on first use), then derive the level change from the
 * stored total. Message and voice XP both go through here, so concurrent awards never overwrite each other.
 */
async function incrementXp(
	guildId: string,
	userId: string,
	amount: number,
	extraSet: Partial<Pick<typeof schema.xp.$inferInsert, 'lastMessageAt'>> = {},
): Promise<TryAddXpResult | null> {
	await getOrCreateXpRow(guildId, userId);
	const result = await db
		.update(schema.xp)
		.set({ totalXp: sql`${schema.xp.totalXp} + ${amount}`, ...extraSet })
		.where(and(eq(schema.xp.guildId, guildId), eq(schema.xp.userId, userId)));
	const affected = Number((result as any)[0]?.affectedRows ?? 0);
	if (affected === 0) return null;

	const [updated] = await db
		.select({ totalXp: schema.xp.totalXp })
		.from(schema.xp)
		.where(and(eq(schema.xp.guildId, guildId), eq(schema.xp.userId, userId)))
		.limit(1);
	if (!updated) return null;

	const newTotal = updated.totalXp;
	const oldTotal = newTotal - amount;
	const { level: oldLevel } = levelFromTotalXp(oldTotal);
	const { level: newLevel } = levelFromTotalXp(newTotal);

	await db
		.update(schema.xp)
		.set({ level: newLevel })
		.where(and(eq(schema.xp.guildId, guildId), eq(schema.xp.userId, userId), eq(schema.xp.totalXp, newTotal)));

	return { leveledUp: newLevel > oldLevel, newLevel, oldLevel };
}

/** Overwrite a user's total XP (admin). */
export async function setXp(guildId: string, userId: string, totalXp: number) {
	const safe = Math.max(0, totalXp);
	const { level } = levelFromTotalXp(safe);
	await db
		.insert(schema.xp)
		.values({ guildId, userId, totalXp: safe, level })
		.onDuplicateKeyUpdate({
			set: { totalXp: safe, level },
		});
}

/** Add or subtract XP (admin). Returns new totals. */
export async function addXpAdmin(
	guildId: string,
	userId: string,
	delta: number,
): Promise<{ totalXp: number; level: number }> {
	const row = await getOrCreateXpRow(guildId, userId);
	const newTotal = Math.max(0, row.totalXp + delta);
	const { level } = levelFromTotalXp(newTotal);
	await db
		.update(schema.xp)
		.set({ totalXp: newTotal, level })
		.where(and(eq(schema.xp.guildId, guildId), eq(schema.xp.userId, userId)));
	return { totalXp: newTotal, level };
}

/** Delete a user's XP record entirely. */
export async function resetXp(guildId: string, userId: string) {
	await db.delete(schema.xp).where(and(eq(schema.xp.guildId, guildId), eq(schema.xp.userId, userId)));
}

// ─── Leaderboard / rank ───────────────────────────────────────────────────────

export async function getLeaderboard(guildId: string, limit = 10, offset = 0): Promise<XpRow[]> {
	return db
		.select()
		.from(schema.xp)
		.where(eq(schema.xp.guildId, guildId))
		.orderBy(desc(schema.xp.totalXp))
		.limit(limit)
		.offset(offset);
}

export async function getTotalLeaderboardEntries(guildId: string): Promise<number> {
	const [res] = await db.select({ n: sql<number>`count(*)` }).from(schema.xp).where(eq(schema.xp.guildId, guildId));
	return res?.n ?? 0;
}

/** 1-indexed rank of the user in their guild (higher total XP = lower number). */
export async function getRank(guildId: string, userId: string): Promise<number> {
	const row = await getXpRow(guildId, userId);
	if (!row) return -1;
	const [res] = await db
		.select({ n: sql<number>`count(*)` })
		.from(schema.xp)
		.where(and(eq(schema.xp.guildId, guildId), gt(schema.xp.totalXp, row.totalXp)));
	return (res?.n ?? 0) + 1;
}

// ─── Level role rewards ───────────────────────────────────────────────────────

export async function getLevelRoles(guildId: string, level: number) {
	return db
		.select()
		.from(schema.levelRoles)
		.where(and(eq(schema.levelRoles.guildId, guildId), eq(schema.levelRoles.level, level)));
}

// ─── Voice XP ─────────────────────────────────────────────────────────────────

/**
 * Award XP for time spent in voice. No cooldown check — voice XP is purely time-based.
 * Requires at least 1 minute to avoid micro-awards on rapid channel switches.
 */
export async function addVoiceXp(
	guildId: string,
	userId: string,
	minutesSpent: number,
	settings: LevelSettingsRow,
	multiplier = 1.0,
): Promise<TryAddXpResult | null> {
	if (minutesSpent < 1) return null;
	const amount = Math.round(minutesSpent * settings.voiceXpPerMinute * multiplier);
	if (amount <= 0) return null;

	// Atomic increment — a read-then-overwrite here would drop message XP earned in the meantime.
	return incrementXp(guildId, userId, amount);
}
