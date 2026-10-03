import { type Guild, type GuildMember, PermissionFlagsBits, type Role } from 'discord.js';

/**
 * Safety checks for roles the bot hands out on its own (verification, invite rewards, role
 * persistence). A staff member configures the role once and the bot then gives it to anyone, so a
 * role is only accepted when the configuring member could manage it themselves and it carries no
 * staff permissions. No database import, so everything here is unit-testable.
 */

// ─── Dangerous permissions ─────────────────────────────────────────────────────

/** Permissions that make a role a staff role. The bot never gives such a role out automatically. */
export const DANGEROUS_ROLE_PERMISSIONS: ReadonlyArray<readonly [bit: bigint, label: string]> = [
	[PermissionFlagsBits.Administrator, 'Administrator'],
	[PermissionFlagsBits.ManageGuild, 'Manage Server'],
	[PermissionFlagsBits.ManageRoles, 'Manage Roles'],
	[PermissionFlagsBits.ManageChannels, 'Manage Channels'],
	[PermissionFlagsBits.ManageWebhooks, 'Manage Webhooks'],
	[PermissionFlagsBits.BanMembers, 'Ban Members'],
	[PermissionFlagsBits.KickMembers, 'Kick Members'],
	[PermissionFlagsBits.ModerateMembers, 'Timeout Members'],
	[PermissionFlagsBits.MentionEveryone, 'Mention @everyone'],
];

/** Labels of the dangerous permissions in a role's permission bitfield, in the order above. */
export function dangerousPermissionNames(permissions: bigint): string[] {
	return DANGEROUS_ROLE_PERMISSIONS.filter(([bit]) => (permissions & bit) === bit).map(([, label]) => label);
}

export function hasDangerousPermissions(permissions: bigint): boolean {
	return DANGEROUS_ROLE_PERMISSIONS.some(([bit]) => (permissions & bit) === bit);
}

// ─── Pure checks ───────────────────────────────────────────────────────────────

/** Where a role sits in the guild's hierarchy. */
export interface RoleRank {
	id: string;
	/** Position in the guild's role list (higher = more powerful). */
	position: number;
}

/** The role facts the checks need, as plain data so they are testable without discord.js. */
export interface RoleFacts extends RoleRank {
	managed: boolean;
	/** The role's own permission bitfield. */
	permissions: bigint;
}

/**
 * True when `role` is `other` or sits at or above it. Two different roles on the same position count
 * as "at" (refused), which is stricter than Discord's ID tie-break and only matters for legacy guilds.
 */
export function isAtOrAbove(role: RoleRank, other: RoleRank): boolean {
	return role.id === other.id || role.position >= other.position;
}

export type RoleSafetyIssue =
	| { kind: 'everyone' }
	| { kind: 'managed' }
	| { kind: 'above-bot' }
	| { kind: 'above-invoker' }
	| { kind: 'dangerous'; permissions: string[] };

export interface GrantContext {
	/** The guild ID, which is also the @everyone role's ID. */
	everyoneId: string;
	/** The bot's highest role. */
	botHighest: RoleRank;
}

export interface InvokerContext {
	/** The configuring member's highest role. */
	highest: RoleRank;
	/** The guild owner may configure any role below the bot. */
	isOwner: boolean;
}

/**
 * Grant time: may the bot give `role` out on its own right now? Rejects @everyone, managed roles,
 * roles at or above the bot's highest role and roles with dangerous permissions. No invoker check:
 * the role was already vetted against the member who configured it.
 */
export function findGrantIssue(role: RoleFacts, ctx: GrantContext): RoleSafetyIssue | null {
	if (role.id === ctx.everyoneId) return { kind: 'everyone' };
	if (role.managed) return { kind: 'managed' };
	if (isAtOrAbove(role, ctx.botHighest)) return { kind: 'above-bot' };
	const dangerous = dangerousPermissionNames(role.permissions);
	if (dangerous.length > 0) return { kind: 'dangerous', permissions: dangerous };
	return null;
}

/**
 * Configuration time: everything `findGrantIssue` checks, plus the role must sit below the invoker's
 * highest role unless the invoker owns the guild (same rule as `/mod role`).
 */
export function findConfigIssue(role: RoleFacts, ctx: GrantContext, invoker: InvokerContext): RoleSafetyIssue | null {
	const issue = findGrantIssue(role, ctx);
	if (issue) return issue;
	if (!invoker.isOwner && isAtOrAbove(role, invoker.highest)) return { kind: 'above-invoker' };
	return null;
}

/** One sentence explaining `issue`. `roleLabel` names the role (a mention for users, name + ID for logs). */
export function describeRoleSafetyIssue(issue: RoleSafetyIssue, roleLabel: string): string {
	switch (issue.kind) {
		case 'everyone':
			return 'The @everyone role cannot be used.';
		case 'managed':
			return `${roleLabel} is managed by an integration or bot and cannot be assigned manually.`;
		case 'above-bot':
			return `${roleLabel} is equal to or higher than my highest role. Move my role above it first.`;
		case 'above-invoker':
			return `${roleLabel} is equal to or higher than your highest role, so you cannot set it up.`;
		case 'dangerous':
			return `${roleLabel} has staff permissions (${issue.permissions.join(', ')}), so I will not hand it out automatically.`;
	}
}

// ─── discord.js wrappers ───────────────────────────────────────────────────────

export function toRoleFacts(role: Role): RoleFacts {
	return { id: role.id, position: role.position, managed: role.managed, permissions: role.permissions.bitfield };
}

/** The bot's own member in `guild`, fetched when it is not cached. Null when it cannot be loaded. */
export async function fetchBotMember(guild: Guild): Promise<GuildMember | null> {
	return guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
}

/**
 * Configuration time: may `invoker` set `role` up for the bot to hand out? Also requires the bot to
 * have Manage Roles. Returns a user-facing error, or null when the role is fine.
 */
export function configurableRoleError(role: Role, invoker: GuildMember, me: GuildMember | null): string | null {
	if (!me) return "I couldn't load my own member in this server.";
	if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) return 'I need the **Manage Roles** permission.';
	const issue = findConfigIssue(
		toRoleFacts(role),
		{ everyoneId: role.guild.id, botHighest: me.roles.highest },
		{ highest: invoker.roles.highest, isOwner: invoker.id === role.guild.ownerId },
	);
	return issue ? describeRoleSafetyIssue(issue, `<@&${role.id}>`) : null;
}

/**
 * Grant time: why the bot should no longer hand out `role` on its own (for a warning log), or null
 * when it is still safe. Catches roles that gained staff permissions or moved above the bot since
 * they were configured.
 */
export function unsafeGrantReason(role: Role, me: GuildMember): string | null {
	const issue = findGrantIssue(toRoleFacts(role), { everyoneId: role.guild.id, botHighest: me.roles.highest });
	return issue ? describeRoleSafetyIssue(issue, `Role "${role.name}" (${role.id})`) : null;
}
