import { and, desc, eq, gt, sql } from 'drizzle-orm';
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
	await db.insert(schema.levelSettings).values({ guildId });
	const [row] = await db.select().from(schema.levelSettings).where(eq(schema.levelSettings.guildId, guildId)).limit(1);
	return row!;
}

export async function upsertLevelSettings(guildId: string, data: Partial<Omit<LevelSettingsRow, 'guildId'>>) {
	const existing = await getLevelSettings(guildId);
	if (existing) {
		await db.update(schema.levelSettings).set(data).where(eq(schema.levelSettings.guildId, guildId));
	} else {
		await db.insert(schema.levelSettings).values({ guildId, ...data });
	}
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
	await db.insert(schema.xp).values({ guildId, userId, totalXp: 0, level: 0 });
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
	await getOrCreateXpRow(guildId, userId);
	const result = await db
		.update(schema.xp)
		.set({ totalXp: sql`${schema.xp.totalXp} + ${amount}`, lastMessageAt: now })
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

	const row = await getXpRow(guildId, userId);
	const oldTotal = row?.totalXp ?? 0;
	const newTotal = oldTotal + amount;
	const { level: oldLevel } = levelFromTotalXp(oldTotal);
	const { level: newLevel } = levelFromTotalXp(newTotal);

	await setXp(guildId, userId, newTotal);

	return { leveledUp: newLevel > oldLevel, newLevel, oldLevel };
}
