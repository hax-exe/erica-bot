import { describe, expect, test } from 'bun:test';
import { type GuildMember, PermissionFlagsBits, PermissionsBitField, type Role } from 'discord.js';
import {
	configurableRoleError,
	DANGEROUS_ROLE_PERMISSIONS,
	dangerousPermissionNames,
	describeRoleSafetyIssue,
	findConfigIssue,
	findGrantIssue,
	hasDangerousPermissions,
	isAtOrAbove,
	type RoleFacts,
	unsafeGrantReason,
} from './RoleSafety.js';

const GUILD = '100';
const BOT_TOP = { id: '900', position: 10 };
const ctx = { everyoneId: GUILD, botHighest: BOT_TOP };

function role(id: string, overrides: Partial<RoleFacts> = {}): RoleFacts {
	return { id, position: 5, managed: false, permissions: 0n, ...overrides };
}

const SAFE_PERMISSIONS =
	PermissionFlagsBits.ViewChannel |
	PermissionFlagsBits.SendMessages |
	PermissionFlagsBits.AttachFiles |
	PermissionFlagsBits.ManageMessages |
	PermissionFlagsBits.ManageNicknames;

describe('dangerousPermissionNames', () => {
	test('every listed permission is dangerous on its own', () => {
		expect(DANGEROUS_ROLE_PERMISSIONS).toHaveLength(9);
		for (const [bit, label] of DANGEROUS_ROLE_PERMISSIONS) {
			expect(dangerousPermissionNames(bit)).toEqual([label]);
			expect(hasDangerousPermissions(bit | SAFE_PERMISSIONS)).toBe(true);
		}
	});

	test('ordinary member permissions are not dangerous', () => {
		expect(dangerousPermissionNames(SAFE_PERMISSIONS)).toEqual([]);
		expect(hasDangerousPermissions(SAFE_PERMISSIONS)).toBe(false);
		expect(hasDangerousPermissions(0n)).toBe(false);
	});

	test('lists every dangerous permission a role has, in a fixed order', () => {
		const bits = PermissionFlagsBits.BanMembers | PermissionFlagsBits.Administrator | PermissionFlagsBits.SendMessages;
		expect(dangerousPermissionNames(bits)).toEqual(['Administrator', 'Ban Members']);
	});
});

describe('isAtOrAbove', () => {
	test('compares by position', () => {
		expect(isAtOrAbove({ id: '1', position: 3 }, { id: '2', position: 4 })).toBe(false);
		expect(isAtOrAbove({ id: '1', position: 5 }, { id: '2', position: 4 })).toBe(true);
	});

	test('the same role, or a different role on the same position, counts as at', () => {
		expect(isAtOrAbove({ id: '1', position: 4 }, { id: '1', position: 4 })).toBe(true);
		expect(isAtOrAbove({ id: '1', position: 4 }, { id: '2', position: 4 })).toBe(true);
	});
});

describe('findGrantIssue', () => {
	test('an ordinary role below the bot is fine', () => {
		expect(findGrantIssue(role('1', { permissions: SAFE_PERMISSIONS }), ctx)).toBeNull();
	});

	test('rejects @everyone', () => {
		expect(findGrantIssue(role(GUILD, { position: 0 }), ctx)).toEqual({ kind: 'everyone' });
	});

	test('rejects managed roles', () => {
		expect(findGrantIssue(role('1', { managed: true }), ctx)).toEqual({ kind: 'managed' });
	});

	test('rejects roles at or above the bot', () => {
		expect(findGrantIssue(role('1', { position: BOT_TOP.position }), ctx)).toEqual({ kind: 'above-bot' });
		expect(findGrantIssue(role('1', { position: 20 }), ctx)).toEqual({ kind: 'above-bot' });
		expect(findGrantIssue(role(BOT_TOP.id, { position: BOT_TOP.position }), ctx)).toEqual({ kind: 'above-bot' });
		expect(findGrantIssue(role('1', { position: BOT_TOP.position - 1 }), ctx)).toBeNull();
	});

	test('rejects roles with dangerous permissions', () => {
		expect(findGrantIssue(role('1', { permissions: PermissionFlagsBits.Administrator }), ctx)).toEqual({
			kind: 'dangerous',
			permissions: ['Administrator'],
		});
		expect(findGrantIssue(role('1', { permissions: PermissionFlagsBits.ModerateMembers }), ctx)).toEqual({
			kind: 'dangerous',
			permissions: ['Timeout Members'],
		});
	});

	test('ignores the invoker entirely', () => {
		// A role far above any normal member is still grantable at grant time when it is below the bot.
		expect(findGrantIssue(role('1', { position: 9 }), ctx)).toBeNull();
	});
});

describe('findConfigIssue', () => {
	const invoker = { highest: { id: '500', position: 6 }, isOwner: false };

	test('a role below both the bot and the invoker is fine', () => {
		expect(findConfigIssue(role('1', { position: 5 }), ctx, invoker)).toBeNull();
	});

	test('rejects roles at or above the invoker', () => {
		expect(findConfigIssue(role('1', { position: 6 }), ctx, invoker)).toEqual({ kind: 'above-invoker' });
		expect(findConfigIssue(role('1', { position: 8 }), ctx, invoker)).toEqual({ kind: 'above-invoker' });
		expect(findConfigIssue(role('500', { position: 6 }), ctx, invoker)).toEqual({ kind: 'above-invoker' });
	});

	test('the guild owner may configure roles above their own highest role', () => {
		expect(findConfigIssue(role('1', { position: 8 }), ctx, { ...invoker, isOwner: true })).toBeNull();
	});

	test('the owner is still bound by the bot hierarchy and the permission rule', () => {
		const owner = { ...invoker, isOwner: true };
		expect(findConfigIssue(role('1', { position: 12 }), ctx, owner)).toEqual({ kind: 'above-bot' });
		expect(
			findConfigIssue(role('1', { position: 2, permissions: PermissionFlagsBits.ManageGuild }), ctx, owner),
		).toEqual({ kind: 'dangerous', permissions: ['Manage Server'] });
	});

	test('still rejects @everyone and managed roles', () => {
		expect(findConfigIssue(role(GUILD, { position: 0 }), ctx, invoker)).toEqual({ kind: 'everyone' });
		expect(findConfigIssue(role('1', { managed: true }), ctx, invoker)).toEqual({ kind: 'managed' });
	});
});

describe('describeRoleSafetyIssue', () => {
	test('names the role and the permissions', () => {
		const text = describeRoleSafetyIssue({ kind: 'dangerous', permissions: ['Administrator', 'Ban Members'] }, '<@&1>');
		expect(text).toContain('<@&1>');
		expect(text).toContain('Administrator, Ban Members');
	});

	test('has a message for every kind', () => {
		for (const issue of [
			{ kind: 'everyone' },
			{ kind: 'managed' },
			{ kind: 'above-bot' },
			{ kind: 'above-invoker' },
		] as const) {
			expect(describeRoleSafetyIssue(issue, '<@&1>').length).toBeGreaterThan(0);
		}
	});
});

// ─── discord.js wrappers (fake objects with only the fields the wrappers read) ──

const OWNER_ID = '1';
const fakeGuild = { id: GUILD, ownerId: OWNER_ID };

function fakeRole(id: string, position: number, permissions = 0n, managed = false): Role {
	return {
		id,
		name: `role-${id}`,
		position,
		managed,
		permissions: new PermissionsBitField(permissions),
		guild: fakeGuild,
	} as unknown as Role;
}

function fakeMember(id: string, highest: Role, permissions = 0n): GuildMember {
	return {
		id,
		roles: { highest },
		permissions: new PermissionsBitField(permissions),
	} as unknown as GuildMember;
}

describe('configurableRoleError', () => {
	const me = fakeMember('bot', fakeRole(BOT_TOP.id, BOT_TOP.position), PermissionFlagsBits.ManageRoles);
	const mod = fakeMember('mod', fakeRole('500', 6), PermissionFlagsBits.ManageGuild);

	test('accepts a safe role below the invoker and the bot', () => {
		expect(configurableRoleError(fakeRole('2', 3, SAFE_PERMISSIONS), mod, me)).toBeNull();
	});

	test('refuses a role above the invoker unless they own the guild', () => {
		const high = fakeRole('2', 8);
		expect(configurableRoleError(high, mod, me)).toContain('your highest role');
		const owner = fakeMember(OWNER_ID, fakeRole('501', 1));
		expect(configurableRoleError(high, owner, me)).toBeNull();
	});

	test('refuses an Administrator role even below the invoker', () => {
		expect(configurableRoleError(fakeRole('2', 3, PermissionFlagsBits.Administrator), mod, me)).toContain(
			'Administrator',
		);
	});

	test('needs the bot member and its Manage Roles permission', () => {
		const safe = fakeRole('2', 3);
		expect(configurableRoleError(safe, mod, null)).not.toBeNull();
		const weakBot = fakeMember('bot', fakeRole(BOT_TOP.id, BOT_TOP.position));
		expect(configurableRoleError(safe, mod, weakBot)).toContain('Manage Roles');
	});
});

describe('unsafeGrantReason', () => {
	const me = fakeMember('bot', fakeRole(BOT_TOP.id, BOT_TOP.position), PermissionFlagsBits.ManageRoles);

	test('a safe role has no reason', () => {
		expect(unsafeGrantReason(fakeRole('2', 9, SAFE_PERMISSIONS), me)).toBeNull();
	});

	test('a role that gained staff permissions or moved above the bot is reported', () => {
		expect(unsafeGrantReason(fakeRole('2', 3, PermissionFlagsBits.KickMembers), me)).toContain('Kick Members');
		expect(unsafeGrantReason(fakeRole('2', 11), me)).toContain('my highest role');
		expect(unsafeGrantReason(fakeRole('2', 3, 0n, true), me)).toContain('managed');
	});
});
