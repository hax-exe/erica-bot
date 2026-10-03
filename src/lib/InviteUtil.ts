import type { Guild, GuildMember, Invite } from 'discord.js';

/**
 * In-memory invite cache: guildId → (inviteCode → useCount)
 * Populated on ready and kept in sync via invite create/delete/member join events.
 */
export const inviteCache = new Map<string, Map<string, number>>();

/** Snapshot the current invites for a guild into the cache. */
export async function cacheGuildInvites(guild: Guild): Promise<void> {
	try {
		const invites = await guild.invites.fetch();
		const map = new Map<string, number>();
		for (const invite of invites.values()) {
			map.set(invite.code, invite.uses ?? 0);
		}
		inviteCache.set(guild.id, map);
	} catch {
		// Bot may lack Manage Guild — skip silently
	}
}

export interface UsedInvite {
	code: string;
	inviterId: string | null;
	inviterUsername: string | null;
	uses: number;
}

/**
 * Detect which invite was used when a member joins.
 * Fetches fresh invites, diffs against cache, then updates cache.
 * Returns the matched invite info, or null if it couldn't be determined.
 */
export async function detectUsedInvite(guild: Guild): Promise<UsedInvite | null> {
	let freshInvites: Map<string, Invite>;
	try {
		const fetched = await guild.invites.fetch();
		freshInvites = new Map(fetched.map((inv) => [inv.code, inv]));
	} catch {
		return null;
	}

	const cached = inviteCache.get(guild.id) ?? new Map<string, number>();

	// Find any invite whose use count increased
	let matched: Invite | null = null;
	for (const [code, invite] of freshInvites) {
		const cachedUses = cached.get(code) ?? 0;
		if ((invite.uses ?? 0) > cachedUses) {
			matched = invite;
			break;
		}
	}

	// Update cache with fresh counts (also add any new codes)
	const updated = new Map<string, number>();
	for (const [code, invite] of freshInvites) {
		updated.set(code, invite.uses ?? 0);
	}
	inviteCache.set(guild.id, updated);

	if (!matched) return null;

	return {
		code: matched.code,
		inviterId: matched.inviterId,
		inviterUsername: matched.inviter?.username ?? null,
		uses: matched.uses ?? 0,
	};
}

// ─── Shared join detection ─────────────────────────────────────────────────────

/** How long a join's detection result is shared between the join logger and the invite tracker. */
export const JOIN_INVITE_TTL_MS = 60_000;

const joinInviteDetections = new Map<string, { promise: Promise<UsedInvite | null>; expires: number }>();

/**
 * Which invite did this member join with? `detectUsedInvite` diffs against (and then updates) the
 * invite cache, so a second call for the same join would see no change and return null. Every
 * GuildMemberAdd consumer therefore goes through this: the detection promise is memoized per join
 * (`guildId:userId:joinedTimestamp`) for 60 seconds and shared. The join time is part of the key so
 * a member who leaves and rejoins within the minute gets a fresh detection, not the previous join's
 * invite. Never rejects (null when unknown).
 */
export function getJoinInvite(member: GuildMember): Promise<UsedInvite | null> {
	const now = Date.now();
	for (const [key, entry] of joinInviteDetections) {
		if (entry.expires <= now) joinInviteDetections.delete(key);
	}

	const key = `${member.guild.id}:${member.id}:${member.joinedTimestamp ?? 'unknown'}`;
	const existing = joinInviteDetections.get(key);
	if (existing) return existing.promise;

	const promise = detectUsedInvite(member.guild).catch(() => null);
	joinInviteDetections.set(key, { promise, expires: now + JOIN_INVITE_TTL_MS });
	return promise;
}

// ─── Invite counting (pure) ────────────────────────────────────────────────────

/** An account younger than this when it joins counts as fake. */
export const FAKE_ACCOUNT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** True when the account was created less than 7 days before `joinedAt`. */
export function isFakeAccount(accountCreatedAtMs: number, joinedAtMs: number): boolean {
	return joinedAtMs - accountCreatedAtMs < FAKE_ACCOUNT_AGE_MS;
}

export interface InviteCounts {
	/** Rows: everyone this inviter brought in. */
	joins: number;
	/** Rows with `left_at` set. */
	left: number;
	/** Rows flagged fake. */
	fake: number;
	/** Rows with no `left_at` that are not fake. */
	effective: number;
}

/** Tally one inviter's `invite_joins` rows. Mirrors the SQL aggregates used for the leaderboard. */
export function countInviteRows(rows: ReadonlyArray<{ leftAt: number | null; fake: boolean }>): InviteCounts {
	const counts: InviteCounts = { joins: rows.length, left: 0, fake: 0, effective: 0 };
	for (const row of rows) {
		if (row.leftAt !== null) counts.left++;
		if (row.fake) counts.fake++;
		if (row.leftAt === null && !row.fake) counts.effective++;
	}
	return counts;
}

/** Reward roles an inviter has earned (`invites <= effective`) and does not already hold, deduplicated. */
export function selectRewardRoleIds(
	effective: number,
	rewards: ReadonlyArray<{ invites: number; roleId: string }>,
	hasRole: (roleId: string) => boolean,
): string[] {
	const earned = new Set<string>();
	for (const reward of rewards) {
		if (reward.invites <= effective && !hasRole(reward.roleId)) earned.add(reward.roleId);
	}
	return [...earned];
}
