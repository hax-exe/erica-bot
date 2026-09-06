import { type Interaction, MessageFlags } from 'discord.js';
import { eq } from 'drizzle-orm';
import { db, schema } from './database.js';

const CACHE_TTL_MS = 30_000;

type CacheEntry = { blocked: boolean; reason: string | null; expires: number };

const cache = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<{ blocked: boolean; reason: string | null }>>();

function ownerIdSet(): Set<string> {
	return new Set(
		(process.env.BOT_OWNER_IDS ?? '')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean),
	);
}

export function invalidateBotBlacklistCache(userId?: string): void {
	if (userId) cache.delete(userId);
	else cache.clear();
	if (userId) pending.delete(userId);
	else pending.clear();
}

export async function getBotBlacklistEntry(userId: string): Promise<{ blocked: boolean; reason: string | null }> {
	// Owners always bypass — /admin blacklist already refuses to add them.
	if (ownerIdSet().has(userId)) return { blocked: false, reason: null };

	const now = Date.now();
	const hit = cache.get(userId);
	if (hit && hit.expires > now) return { blocked: hit.blocked, reason: hit.reason };

	let inflight = pending.get(userId);
	if (!inflight) {
		inflight = (async () => {
			const entry = await db
				.select()
				.from(schema.botBlacklist)
				.where(eq(schema.botBlacklist.userId, userId))
				.limit(1)
				.then((r) => r[0] ?? null);

			const result = entry
				? {
						blocked: true,
						reason: entry.reason && entry.reason !== 'No reason provided' ? entry.reason : null,
					}
				: { blocked: false, reason: null };

			cache.set(userId, { ...result, expires: Date.now() + CACHE_TTL_MS });
			pending.delete(userId);
			return result;
		})();
		pending.set(userId, inflight);
	}

	return inflight;
}

export async function isBotBlacklisted(userId: string): Promise<boolean> {
	return (await getBotBlacklistEntry(userId)).blocked;
}

export function formatBlacklistDenial(reason: string | null): string {
	return reason
		? `You have been blacklisted from using this bot. Reason: ${reason}`
		: 'You have been blacklisted from using this bot.';
}

/**
 * If the user is bot-blacklisted, optionally acknowledge the interaction and return true.
 * Callers should `return` when this is true.
 */
export async function rejectBlacklistedInteraction(
	interaction: Interaction,
	opts?: { silent?: boolean },
): Promise<boolean> {
	if (interaction.user.bot) return false;

	const entry = await getBotBlacklistEntry(interaction.user.id);
	if (!entry.blocked) return false;

	if (!opts?.silent) {
		const message = formatBlacklistDenial(entry.reason);
		try {
			if (interaction.isAutocomplete()) {
				await interaction.respond([]);
			} else if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
				await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
			}
		} catch {
			// 10062 / 40060 — stale or already acknowledged
		}
	}

	return true;
}
