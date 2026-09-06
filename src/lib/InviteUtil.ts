import type { Guild, Invite } from 'discord.js';

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
