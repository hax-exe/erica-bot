import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	escapeMarkdown,
	MessageFlags,
	RESTJSONErrorCodes,
	TextDisplayBuilder,
} from 'discord.js';
import { and, asc, eq } from 'drizzle-orm';
import { highlights } from '../db/schema.js';
import { Colors, makeContainer } from './components.js';
import { isDuplicateKeyError } from './safe.js';

/**
 * `database.js` connects to MySQL and runs migrations as soon as it is imported, so it is loaded lazily:
 * the pure helpers in this file stay importable (and unit-testable) without a DATABASE_URL.
 */
async function getDb() {
	return (await import('./database.js')).db;
}

// ─── Limits ─────────────────────────────────────────────────────────────────

export const MIN_KEYWORD_LENGTH = 2;
export const MAX_KEYWORD_LENGTH = 32;
export const MAX_HIGHLIGHTS_PER_MEMBER = 10;
/** A member who posted in a channel within this window is not DMed about it. */
export const ACTIVITY_WINDOW_MS = 5 * 60_000;
/** A member is DMed at most once per channel within this window. */
export const NOTIFY_COOLDOWN_MS = 5 * 60_000;
/** Longest message excerpt quoted in the DM. */
export const QUOTE_MAX_CHARS = 500;
/** At most this many members are DMed about one message (the rest are skipped, in keyword match order). */
export const MAX_RECIPIENTS_PER_MESSAGE = 10;
/** At most this many candidates are checked (member lookup, permissions, blacklist) for one message. */
export const MAX_CANDIDATES_CHECKED_PER_MESSAGE = 30;
/** A subscriber the API reported as no longer in the guild (10007) is not looked up again for this long. */
export const MISSING_MEMBER_COOLDOWN_MS = 10 * 60_000;
/** A member gets at most `MEMBER_DM_BUDGET` highlight DMs per `MEMBER_DM_WINDOW_MS`, across all channels. */
export const MEMBER_DM_BUDGET = 5;
export const MEMBER_DM_WINDOW_MS = 10 * 60_000;
/** After Discord answers "opening DMs too fast" (40003), no highlight DM is sent for this long. */
export const DM_BACKOFF_MS = 60_000;

const GUILD_CACHE_TTL_MS = 60_000;
const MAX_ACTIVITY_ENTRIES = 100_000;
const MAX_COOLDOWN_ENTRIES = 50_000;
const MAX_BUDGET_ENTRIES = 50_000;
const MAX_MISSING_MEMBER_ENTRIES = 50_000;
const MAX_COMPILED_KEYWORDS = 5_000;

// ─── Keyword matching (pure) ────────────────────────────────────────────────

export interface HighlightEntry {
	userId: string;
	keyword: string;
}

export interface HighlightMatch {
	userId: string;
	/** The (normalised) keyword that matched. */
	keyword: string;
}

/** Keywords are stored trimmed and lowercase. */
export function normalizeKeyword(raw: string): string {
	return raw.trim().toLowerCase();
}

/** True when a normalised keyword is 2-32 characters. */
export function isValidKeywordLength(keyword: string): boolean {
	return keyword.length >= MIN_KEYWORD_LENGTH && keyword.length <= MAX_KEYWORD_LENGTH;
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Letters, digits and underscore in any script. `\b` is ASCII-only and fails next to symbols like `+` or `#`. */
const WORD_CHAR = '[\\p{L}\\p{N}_]';

type CompiledKeyword = { needle: string; pattern: RegExp };
const compiledKeywords = new Map<string, CompiledKeyword>();

/** Compiled once per distinct keyword. The patterns have no `g`/`y` flag, so sharing them is stateless. */
function compileKeyword(keyword: string): CompiledKeyword {
	let compiled = compiledKeywords.get(keyword);
	if (!compiled) {
		const needle = normalizeKeyword(keyword);
		compiled = {
			needle,
			// The haystack is lowercased too, so no `i` flag is needed.
			pattern: new RegExp(`(?<!${WORD_CHAR})${escapeRegExp(needle)}(?!${WORD_CHAR})`, 'u'),
		};
		if (compiledKeywords.size >= MAX_COMPILED_KEYWORDS) compiledKeywords.clear();
		compiledKeywords.set(keyword, compiled);
	}
	return compiled;
}

/**
 * Members whose keyword appears in `content` as a whole word (case-insensitive). The author is never
 * matched, and each member appears at most once (first matching keyword in `entries` order).
 */
export function findHighlightMatches(
	content: string,
	entries: readonly HighlightEntry[],
	authorId: string,
): HighlightMatch[] {
	if (!content || entries.length === 0) return [];

	const text = content.toLowerCase();
	const matchedUsers = new Set<string>();
	const matches: HighlightMatch[] = [];

	for (const entry of entries) {
		if (entry.userId === authorId || matchedUsers.has(entry.userId)) continue;
		const { needle, pattern } = compileKeyword(entry.keyword);
		// The substring test is a cheap pre-filter before the regex.
		if (!needle || !text.includes(needle) || !pattern.test(text)) continue;
		matchedUsers.add(entry.userId);
		matches.push({ userId: entry.userId, keyword: needle });
	}

	return matches;
}

// ─── Activity, cooldown and send-limit trackers ─────────────────────────────

/**
 * Remembers when each key was last touched and answers "within the window?". Self-pruning: insertion
 * order equals recency order (a touch re-inserts the key), so expired entries are always at the front
 * and a prune only walks the stale prefix. `maxEntries` is a hard cap that evicts the oldest first.
 */
export class RecencyTracker {
	private readonly times = new Map<string, number>();

	public constructor(
		private readonly windowMs: number,
		private readonly maxEntries: number,
	) {}

	public touch(key: string, now = Date.now()): void {
		this.times.delete(key);
		this.times.set(key, now);
		this.prune(now);
	}

	public isRecent(key: string, now = Date.now()): boolean {
		const at = this.times.get(key);
		return at !== undefined && now - at < this.windowMs;
	}

	public forget(key: string): void {
		this.times.delete(key);
	}

	public prune(now = Date.now()): void {
		for (const [key, at] of this.times) {
			if (this.times.size > this.maxEntries || now - at >= this.windowMs) this.times.delete(key);
			else break;
		}
	}

	public get size(): number {
		return this.times.size;
	}
}

/**
 * Sliding-window send budget: at most `limit` sends per key within `windowMs`. Bounded like `RecencyTracker`:
 * entries are kept in order of their last send, so expired ones sit at the front and a prune only walks that
 * prefix; `maxEntries` is a hard cap that evicts the oldest first. Each entry holds at most `limit` timestamps.
 */
export class SendBudget {
	private readonly sends = new Map<string, number[]>();

	public constructor(
		private readonly limit: number,
		private readonly windowMs: number,
		private readonly maxEntries: number,
	) {}

	/** True when `key` could send right now. Does not consume anything. */
	public hasBudget(key: string, now = Date.now()): boolean {
		const stamps = this.sends.get(key);
		if (!stamps) return this.limit > 0;
		let recent = 0;
		for (const at of stamps) if (now - at < this.windowMs) recent++;
		return recent < this.limit;
	}

	/** Spends one send for `key` at `now`. Returns false (and spends nothing) when the budget is used up. */
	public tryConsume(key: string, now = Date.now()): boolean {
		const recent = (this.sends.get(key) ?? []).filter((at) => now - at < this.windowMs);
		if (recent.length >= this.limit) return false;
		recent.push(now);
		this.sends.delete(key);
		this.sends.set(key, recent);
		this.prune(now);
		return true;
	}

	/** Gives back a send spent at `at` (the send failed, so it must not count). */
	public refund(key: string, at: number): void {
		const stamps = this.sends.get(key);
		if (!stamps) return;
		const index = stamps.lastIndexOf(at);
		if (index === -1) return;
		stamps.splice(index, 1);
		if (stamps.length === 0) this.sends.delete(key);
	}

	public prune(now = Date.now()): void {
		for (const [key, stamps] of this.sends) {
			const newest = stamps[stamps.length - 1];
			if (this.sends.size > this.maxEntries || newest === undefined || now - newest >= this.windowMs) {
				this.sends.delete(key);
			} else break;
		}
	}

	public get size(): number {
		return this.sends.size;
	}
}

/** A pause switch: while paused, nothing should be sent. Pausing again never shortens a running pause. */
export class DmBackoff {
	private until = 0;

	/** Returns true when this call started a new pause (false when one was already running). */
	public pause(durationMs: number, now = Date.now()): boolean {
		const started = !this.isPaused(now);
		this.until = Math.max(this.until, now + durationMs);
		return started;
	}

	public isPaused(now = Date.now()): boolean {
		return now < this.until;
	}
}

/**
 * Per-message limits. A recipient slot is taken for every DM that is attempted (a failed send used an API call
 * too); `beginCheck()` counts every candidate whose eligibility is looked up, so a message full of ineligible
 * subscribers cannot cost unbounded lookups. `halt()` closes the gate for the rest of the message.
 */
export class RecipientCap {
	private count = 0;
	private checked = 0;
	private halted = false;

	public constructor(
		private readonly max = MAX_RECIPIENTS_PER_MESSAGE,
		private readonly maxChecked = MAX_CANDIDATES_CHECKED_PER_MESSAGE,
	) {}

	/** True once no further candidate should be checked or DMed for this message. */
	public get isFull(): boolean {
		return this.halted || this.count >= this.max || this.checked >= this.maxChecked;
	}

	public get taken(): number {
		return this.count;
	}

	public get checkedCount(): number {
		return this.checked;
	}

	/** Count one candidate whose eligibility is about to be looked up. */
	public beginCheck(): void {
		this.checked++;
	}

	/** Claims a slot; false when the cap is reached or the gate was halted. */
	public take(): boolean {
		if (this.isFull) return false;
		this.count++;
		return true;
	}

	public halt(): void {
		this.halted = true;
	}
}

export type DmFailure = 'closed' | 'too-fast' | 'other';

/** 50007: the member's DMs are closed or the bot is blocked. 40003: Discord says DMs are being opened too fast. */
export function classifyDmError(error: unknown): DmFailure {
	const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
	if (code === RESTJSONErrorCodes.OpeningDirectMessagesTooFast) return 'too-fast';
	if (code === RESTJSONErrorCodes.CannotSendMessagesToThisUser) return 'closed';
	return 'other';
}

/** 10007: the user is not a member of the guild. */
export function isUnknownMemberError(error: unknown): boolean {
	const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
	return code === RESTJSONErrorCodes.UnknownMember;
}

const activity = new RecencyTracker(ACTIVITY_WINDOW_MS, MAX_ACTIVITY_ENTRIES);
const notified = new RecencyTracker(NOTIFY_COOLDOWN_MS, MAX_COOLDOWN_ENTRIES);
/** Keyed by user only: the budget spans channels (and servers), since DMs are per recipient. */
const dmBudget = new SendBudget(MEMBER_DM_BUDGET, MEMBER_DM_WINDOW_MS, MAX_BUDGET_ENTRIES);
const dmBackoff = new DmBackoff();
const missingMembers = new RecencyTracker(MISSING_MEMBER_COOLDOWN_MS, MAX_MISSING_MEMBER_ENTRIES);

function trackerKey(channelId: string, userId: string): string {
	return `${channelId}:${userId}`;
}

/** Record that `userId` just posted in `channelId`. */
export function recordActivity(channelId: string, userId: string, now = Date.now()): void {
	activity.touch(trackerKey(channelId, userId), now);
}

export function hasRecentActivity(channelId: string, userId: string, now = Date.now()): boolean {
	return activity.isRecent(trackerKey(channelId, userId), now);
}

/** Record that `userId` was just DMed about `channelId`. */
export function markNotified(channelId: string, userId: string, now = Date.now()): void {
	notified.touch(trackerKey(channelId, userId), now);
}

export function wasRecentlyNotified(channelId: string, userId: string, now = Date.now()): boolean {
	return notified.isRecent(trackerKey(channelId, userId), now);
}

/** Undo `markNotified` (the DM never reached the member and should be retried). */
export function clearNotified(channelId: string, userId: string): void {
	notified.forget(trackerKey(channelId, userId));
}

/** True when the member has not used up their highlight DM budget. Does not spend it. */
export function hasDmBudget(userId: string, now = Date.now()): boolean {
	return dmBudget.hasBudget(userId, now);
}

/** Spend one DM from the member's budget; false when it is used up. Call `refundDmBudget` if the send fails. */
export function consumeDmBudget(userId: string, now = Date.now()): boolean {
	return dmBudget.tryConsume(userId, now);
}

export function refundDmBudget(userId: string, at: number): void {
	dmBudget.refund(userId, at);
}

/** Remember that the API says `userId` is not in `guildId` (10007), so the lookup is not repeated on every message. */
export function markMemberMissing(guildId: string, userId: string, now = Date.now()): void {
	missingMembers.touch(trackerKey(guildId, userId), now);
}

export function isMemberMissing(guildId: string, userId: string, now = Date.now()): boolean {
	return missingMembers.isRecent(trackerKey(guildId, userId), now);
}

export function isHighlightDmPaused(now = Date.now()): boolean {
	return dmBackoff.isPaused(now);
}

/** Pause all highlight DMs for `DM_BACKOFF_MS`. Returns true when this started a new pause. */
export function pauseHighlightDms(now = Date.now()): boolean {
	return dmBackoff.pause(DM_BACKOFF_MS, now);
}

// ─── Guild keyword cache ────────────────────────────────────────────────────

const guildCache = new Map<string, { entries: HighlightEntry[]; expires: number }>();
/** Shared in-flight loads so a burst of messages on a cold cache costs one query. */
const guildLoads = new Map<string, Promise<HighlightEntry[]>>();
/** Bumped by every invalidation so a load that started before a write never repopulates the cache. */
let cacheGeneration = 0;

async function loadGuildHighlights(guildId: string): Promise<HighlightEntry[]> {
	const db = await getDb();
	return db
		.select({ userId: highlights.userId, keyword: highlights.keyword })
		.from(highlights)
		.where(eq(highlights.guildId, guildId))
		.orderBy(asc(highlights.id));
}

/** All highlight entries of a guild, cached for 60 s. Cheap enough to call on every message. */
export function getGuildHighlights(guildId: string): Promise<HighlightEntry[]> {
	const hit = guildCache.get(guildId);
	if (hit && hit.expires > Date.now()) return Promise.resolve(hit.entries);

	const inflight = guildLoads.get(guildId);
	if (inflight) return inflight;

	const generation = cacheGeneration;
	const load: Promise<HighlightEntry[]> = loadGuildHighlights(guildId)
		.then((entries) => {
			if (generation === cacheGeneration) {
				const now = Date.now();
				for (const [id, cached] of guildCache) if (cached.expires <= now) guildCache.delete(id);
				guildCache.set(guildId, { entries, expires: now + GUILD_CACHE_TTL_MS });
			}
			return entries;
		})
		.finally(() => {
			if (guildLoads.get(guildId) === load) guildLoads.delete(guildId);
		});
	guildLoads.set(guildId, load);
	return load;
}

/** Drop a guild's cached entries. Call after every add / remove / clear. */
export function invalidateHighlightCache(guildId: string): void {
	cacheGeneration++;
	guildCache.delete(guildId);
	guildLoads.delete(guildId);
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

/** A member's own keywords in this guild, oldest first. */
export async function listHighlights(guildId: string, userId: string): Promise<string[]> {
	const db = await getDb();
	const rows = await db
		.select({ keyword: highlights.keyword })
		.from(highlights)
		.where(and(eq(highlights.guildId, guildId), eq(highlights.userId, userId)))
		.orderBy(asc(highlights.id));
	return rows.map((r) => r.keyword);
}

export type AddHighlightResult = { ok: true } | { ok: false; reason: 'duplicate' | 'limit' };

/** `keyword` must already be normalised and length-checked. */
export async function addHighlight(guildId: string, userId: string, keyword: string): Promise<AddHighlightResult> {
	const existing = await listHighlights(guildId, userId);
	if (existing.includes(keyword)) return { ok: false, reason: 'duplicate' };
	if (existing.length >= MAX_HIGHLIGHTS_PER_MEMBER) return { ok: false, reason: 'limit' };

	const db = await getDb();
	try {
		await db.insert(highlights).values({ guildId, userId, keyword });
	} catch (err) {
		if (isDuplicateKeyError(err)) return { ok: false, reason: 'duplicate' };
		throw err;
	} finally {
		invalidateHighlightCache(guildId);
	}
	return { ok: true };
}

/** Returns false when the member had no such keyword. */
export async function removeHighlight(guildId: string, userId: string, keyword: string): Promise<boolean> {
	const db = await getDb();
	try {
		const result = await db
			.delete(highlights)
			.where(and(eq(highlights.guildId, guildId), eq(highlights.userId, userId), eq(highlights.keyword, keyword)));
		return Number((result as any)[0]?.affectedRows ?? 0) > 0;
	} finally {
		invalidateHighlightCache(guildId);
	}
}

/** Remove all of a member's keywords in this guild; returns how many were removed. */
export async function clearHighlights(guildId: string, userId: string): Promise<number> {
	const db = await getDb();
	try {
		const result = await db
			.delete(highlights)
			.where(and(eq(highlights.guildId, guildId), eq(highlights.userId, userId)));
		return Number((result as any)[0]?.affectedRows ?? 0);
	} finally {
		invalidateHighlightCache(guildId);
	}
}

// ─── DM payload ─────────────────────────────────────────────────────────────

/** Truncate to `max` code points (never splits an emoji's surrogate pair), appending an ellipsis when cut. */
function truncateChars(text: string, max: number): string {
	const chars = Array.from(text);
	return chars.length > max ? `${chars.slice(0, max).join('')}…` : text;
}

/** The message text as a Discord block quote, cut to 500 characters. */
export function formatQuote(content: string, max = QUOTE_MAX_CHARS): string {
	return truncateChars(content.trim(), max)
		.split('\n')
		.map((line) => `> ${line}`)
		.join('\n');
}

/** CV2 DM: the keyword as header, "mentioned by author in channel", the quoted message and a jump button. */
export function buildHighlightDm(opts: {
	keyword: string;
	channelId: string;
	authorId: string;
	content: string;
	url: string;
}) {
	// The header is added directly rather than through makeContainer's `header`, whose plainHeader() would
	// strip a keyword's leading emoji.
	const container = makeContainer({ color: Colors.Info });
	container.addTextDisplayComponents(
		new TextDisplayBuilder().setContent(`### ${escapeMarkdown(opts.keyword)}`),
		new TextDisplayBuilder().setContent(`-# Mentioned by <@${opts.authorId}> in <#${opts.channelId}>`),
		new TextDisplayBuilder().setContent(formatQuote(opts.content)),
	);
	container.addActionRowComponents(
		new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Jump to message').setURL(opts.url),
		),
	);

	// Never `content` alongside IsComponentsV2; `parse: []` keeps quoted @everyone / role pings inert.
	return { components: [container], flags: MessageFlags.IsComponentsV2 as const, allowedMentions: { parse: [] as [] } };
}
