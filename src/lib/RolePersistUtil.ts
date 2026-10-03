import { container } from '@sapphire/framework';
import { type GuildMember, PermissionFlagsBits } from 'discord.js';
import { and, eq, sql } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { fetchBotMember, findGrantIssue, type RoleFacts, type RoleRank, toRoleFacts } from './RoleSafety.js';
import { safeJsonParse } from './safe.js';

/**
 * database.ts needs DATABASE_URL and runs migrations the moment it is imported, so it is loaded on
 * first use. That keeps the pure helpers below importable from unit tests.
 */
async function getDb() {
	return (await import('./database.js')).db;
}

// ─── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Role IDs worth saving when a member leaves: everything except @everyone, managed
 * (integration/bot) roles and roles on the guild's ignore list.
 */
export function filterSavableRoleIds(
	roles: readonly Pick<RoleFacts, 'id' | 'managed'>[],
	everyoneId: string,
	ignoredRoleIds: readonly string[],
): string[] {
	const ignored = new Set(ignoredRoleIds);
	return roles.filter((r) => r.id !== everyoneId && !r.managed && !ignored.has(r.id)).map((r) => r.id);
}

/**
 * Which saved role IDs may be given back to a returning member. A role is restored only when it
 * still exists, is not ignored or already held, and passes the RoleSafety grant check (not
 * @everyone or managed, strictly below the bot's highest role, no staff permissions such as
 * Administrator, Manage Server or Ban Members). Saved order is kept, duplicates dropped.
 */
export function filterRestorableRoleIds(input: {
	savedRoleIds: readonly string[];
	/** Every role the guild has right now; saved IDs missing from here were deleted. */
	guildRoles: readonly RoleFacts[];
	everyoneId: string;
	ignoredRoleIds: readonly string[];
	botHighestRole: RoleRank;
	heldRoleIds?: readonly string[];
}): string[] {
	const byId = new Map(input.guildRoles.map((r) => [r.id, r]));
	const ignored = new Set(input.ignoredRoleIds);
	const held = new Set(input.heldRoleIds ?? []);
	const grantContext = { everyoneId: input.everyoneId, botHighest: input.botHighestRole };
	const seen = new Set<string>();
	const restorable: string[] = [];

	for (const id of input.savedRoleIds) {
		if (seen.has(id)) continue;
		seen.add(id);

		const role = byId.get(id);
		if (!role || ignored.has(id) || held.has(id)) continue;
		if (findGrantIssue(role, grantContext)) continue;
		restorable.push(id);
	}
	return restorable;
}

/** `<@&id>, <@&id> …and N more`, kept under `maxLength` so a log field never cuts a mention in half. */
export function formatRoleList(roleIds: readonly string[], maxLength = 900): string {
	if (roleIds.length === 0) return '*(none)*';
	const kept: string[] = [];
	let length = 0;
	for (let i = 0; i < roleIds.length; i++) {
		const mention = `<@&${roleIds[i]}>`;
		const added = (kept.length ? 2 : 0) + mention.length;
		const remainingAfter = roleIds.length - i - 1;
		const reserve = remainingAfter > 0 ? ` …and ${remainingAfter} more`.length : 0;
		if (length + added + reserve > maxLength) {
			const omitted = roleIds.length - i;
			return kept.length ? `${kept.join(', ')} …and ${omitted} more` : `…and ${omitted} more`;
		}
		kept.push(mention);
		length += added;
	}
	return kept.join(', ');
}

// ─── Settings ──────────────────────────────────────────────────────────────────

export interface RolePersistSettings {
	ignoredRoleIds: string[];
	restoreNickname: boolean;
}

/** A JSON array of role IDs from a text column; anything that is not a string is dropped. */
function parseRoleIdList(raw: string | null | undefined): string[] {
	return safeJsonParse<unknown[]>(raw, []).filter((id): id is string => typeof id === 'string');
}

/** The guild's settings, or the column defaults when it has no row. */
export async function getRolePersistSettings(guildId: string): Promise<RolePersistSettings> {
	const db = await getDb();
	const [row] = await db
		.select()
		.from(schema.rolePersistenceSettings)
		.where(eq(schema.rolePersistenceSettings.guildId, guildId))
		.limit(1);
	return {
		ignoredRoleIds: parseRoleIdList(row?.ignoredRoleIds),
		restoreNickname: row?.restoreNickname ?? false,
	};
}

export async function setRestoreNickname(guildId: string, enabled: boolean): Promise<void> {
	const db = await getDb();
	await db
		.insert(schema.rolePersistenceSettings)
		.values({ guildId, restoreNickname: enabled })
		.onDuplicateKeyUpdate({ set: { restoreNickname: enabled } });
}

/**
 * Read-modify-write on the ignore list under a row lock, so two staff members editing it at the
 * same time cannot overwrite each other. `mutate` gets a copy of the current list and returns the new one.
 */
export async function updateIgnoredRoles(
	guildId: string,
	mutate: (current: string[]) => string[],
): Promise<{ before: string[]; after: string[] }> {
	const db = await getDb();
	const table = schema.rolePersistenceSettings;
	return db.transaction(async (tx) => {
		// No-op upsert so the row exists to lock.
		await tx
			.insert(table)
			.values({ guildId })
			.onDuplicateKeyUpdate({ set: { guildId: sql`${table.guildId}` } });
		const [row] = await tx.select().from(table).where(eq(table.guildId, guildId)).limit(1).for('update');
		const before = parseRoleIdList(row?.ignoredRoleIds);
		const after = mutate([...before]);
		await tx
			.update(table)
			.set({ ignoredRoleIds: JSON.stringify(after) })
			.where(eq(table.guildId, guildId));
		return { before, after };
	});
}

// ─── Snapshots ─────────────────────────────────────────────────────────────────

/** Delete a saved snapshot. Returns whether one existed. */
export async function deleteSnapshot(guildId: string, userId: string): Promise<boolean> {
	const db = await getDb();
	const result = await db
		.delete(schema.memberRoleSnapshots)
		.where(and(eq(schema.memberRoleSnapshots.guildId, guildId), eq(schema.memberRoleSnapshots.userId, userId)));
	return Number((result as any)[0]?.affectedRows ?? 0) > 0;
}

/**
 * Save the leaving member's roles (and nickname) for a later rejoin, replacing any earlier snapshot.
 * With nothing worth restoring the existing snapshot is deleted instead, so a stale one can never
 * hand back roles the member no longer had when they left.
 */
export async function saveMemberSnapshot(member: GuildMember): Promise<'saved' | 'cleared'> {
	const { guild } = member;
	const settings = await getRolePersistSettings(guild.id);
	const roleIds = filterSavableRoleIds(
		[...member.roles.cache.values()].map(toRoleFacts),
		guild.roles.everyone.id,
		settings.ignoredRoleIds,
	);
	const nickname = member.nickname ?? null;

	if (roleIds.length === 0 && !(settings.restoreNickname && nickname)) {
		await deleteSnapshot(guild.id, member.id);
		return 'cleared';
	}

	const db = await getDb();
	const savedAt = Date.now();
	await db
		.insert(schema.memberRoleSnapshots)
		.values({ guildId: guild.id, userId: member.id, roleIds: JSON.stringify(roleIds), nickname, savedAt })
		.onDuplicateKeyUpdate({ set: { roleIds: JSON.stringify(roleIds), nickname, savedAt } });
	return 'saved';
}

export interface RestoreResult {
	/** Roles that were added back. */
	restoredRoleIds: string[];
	/** Saved roles that could not be given back (deleted, managed, too high, staff permissions, ignored, API error). */
	skippedCount: number;
	/** The nickname that was applied, if any. */
	nickname: string | null;
	/** When the snapshot was saved (epoch ms), i.e. when the member left. */
	savedAt: number;
}

async function getSnapshot(guildId: string, userId: string) {
	const db = await getDb();
	const [snapshot] = await db
		.select()
		.from(schema.memberRoleSnapshots)
		.where(and(eq(schema.memberRoleSnapshots.guildId, guildId), eq(schema.memberRoleSnapshots.userId, userId)))
		.limit(1);
	return snapshot ?? null;
}

/** The restore filter for one member, with the guild's live roles and the bot's current position. */
function restorableFor(
	member: GuildMember,
	me: GuildMember,
	savedRoleIds: readonly string[],
	ignoredRoleIds: readonly string[],
	heldRoleIds?: readonly string[],
): string[] {
	const { guild } = member;
	return filterRestorableRoleIds({
		savedRoleIds,
		guildRoles: [...guild.roles.cache.values()].map(toRoleFacts),
		everyoneId: guild.roles.everyone.id,
		ignoredRoleIds,
		botHighestRole: me.roles.highest,
		heldRoleIds,
	});
}

/**
 * Read-only: does this member have a saved snapshot that would give `roleId` back when it is
 * restored (saved, not ignored, still safe to grant)? The verification join listener uses it to
 * leave out the unverified role for a returning verified member. The caller checks that the
 * Role Persistence module is on.
 */
export async function snapshotRestoresRole(member: GuildMember, roleId: string): Promise<boolean> {
	const snapshot = await getSnapshot(member.guild.id, member.id);
	if (!snapshot || !parseRoleIdList(snapshot.roleIds).includes(roleId)) return false;

	const me = await fetchBotMember(member.guild);
	if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) return false;
	const settings = await getRolePersistSettings(member.guild.id);
	return restorableFor(member, me, [roleId], settings.ignoredRoleIds).length > 0;
}

/**
 * Give a rejoining member their saved roles (and nickname) back, then delete the snapshot.
 * Returns null when there is no snapshot. API failures are logged and never thrown, and the snapshot
 * is deleted either way so it only ever applies to one rejoin.
 */
export async function restoreMemberSnapshot(member: GuildMember): Promise<RestoreResult | null> {
	const { guild } = member;
	const snapshot = await getSnapshot(guild.id, member.id);
	if (!snapshot) return null;

	const result: RestoreResult = { restoredRoleIds: [], skippedCount: 0, nickname: null, savedAt: snapshot.savedAt };
	try {
		const settings = await getRolePersistSettings(guild.id);
		const me = await fetchBotMember(guild);
		const savedRoleIds = parseRoleIdList(snapshot.roleIds);

		// Taken before any role is added: other join listeners (autoroles) may have added roles already.
		const heldRoleIds = new Set(member.roles.cache.keys());

		if (me && savedRoleIds.length > 0 && me.permissions.has(PermissionFlagsBits.ManageRoles)) {
			const restorable = restorableFor(member, me, savedRoleIds, settings.ignoredRoleIds, [...heldRoleIds]);
			// One PUT per role. roles.add([...]) would PATCH the whole role list built from the cache and
			// could drop a role another join listener (autoroles, verification) adds at the same moment.
			for (const roleId of restorable) {
				try {
					await guild.members.addRole({ user: member, role: roleId, reason: 'Role persistence' });
					result.restoredRoleIds.push(roleId);
				} catch (err) {
					container.logger.error(
						`[rolepersist] Failed to restore role ${roleId} for ${member.id} in ${guild.id}:`,
						err,
					);
				}
			}
		}
		// Everything saved that was neither given back nor already held counts as skipped.
		const distinctSaved = new Set(savedRoleIds);
		const alreadyHeld = [...distinctSaved].filter((id) => heldRoleIds.has(id)).length;
		result.skippedCount = Math.max(0, distinctSaved.size - alreadyHeld - result.restoredRoleIds.length);

		if (
			settings.restoreNickname &&
			snapshot.nickname &&
			member.nickname !== snapshot.nickname &&
			me?.permissions.has(PermissionFlagsBits.ManageNicknames)
		) {
			try {
				await member.setNickname(snapshot.nickname, 'Role persistence');
				result.nickname = snapshot.nickname;
			} catch (err) {
				container.logger.error(`[rolepersist] Failed to restore nickname for ${member.id} in ${guild.id}:`, err);
			}
		}
	} finally {
		await deleteSnapshot(guild.id, member.id).catch((err: unknown) => {
			container.logger.error(`[rolepersist] Failed to delete snapshot for ${member.id} in ${guild.id}:`, err);
		});
	}
	return result;
}
