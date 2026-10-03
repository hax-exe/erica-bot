import { describe, expect, test } from 'bun:test';
import { PermissionFlagsBits } from 'discord.js';
import { filterRestorableRoleIds, filterSavableRoleIds, formatRoleList } from './RolePersistUtil.js';
import type { RoleFacts } from './RoleSafety.js';

const EVERYONE = 'g1';
const BOT_TOP = 10;
const BOT_ROLE = { id: 'bot-role', position: BOT_TOP };

function role(id: string, overrides: Partial<RoleFacts> = {}): RoleFacts {
	return { id, managed: false, position: 5, permissions: 0n, ...overrides };
}

function restorable(input: Partial<Parameters<typeof filterRestorableRoleIds>[0]> & { guildRoles: RoleFacts[] }) {
	return filterRestorableRoleIds({
		savedRoleIds: input.guildRoles.map((r) => r.id),
		everyoneId: EVERYONE,
		ignoredRoleIds: [],
		botHighestRole: BOT_ROLE,
		...input,
	});
}

describe('filterRestorableRoleIds', () => {
	test('keeps ordinary roles below the bot, in saved order', () => {
		const roles = [role('a', { position: 3 }), role('b', { position: 9 }), role('c', { position: 1 })];
		expect(restorable({ guildRoles: roles })).toEqual(['a', 'b', 'c']);
	});

	test('drops roles that no longer exist', () => {
		expect(restorable({ savedRoleIds: ['a', 'deleted'], guildRoles: [role('a')] })).toEqual(['a']);
	});

	test('drops @everyone', () => {
		expect(restorable({ guildRoles: [role(EVERYONE, { position: 0 }), role('a')] })).toEqual(['a']);
	});

	test('drops managed roles', () => {
		expect(restorable({ guildRoles: [role('a', { managed: true }), role('b')] })).toEqual(['b']);
	});

	test('drops roles with Administrator', () => {
		const admin = role('a', { permissions: PermissionFlagsBits.Administrator });
		expect(restorable({ guildRoles: [admin, role('b')] })).toEqual(['b']);
	});

	test('drops roles with any other staff permission', () => {
		const staff = [
			PermissionFlagsBits.ManageGuild,
			PermissionFlagsBits.ManageRoles,
			PermissionFlagsBits.ManageChannels,
			PermissionFlagsBits.ManageWebhooks,
			PermissionFlagsBits.BanMembers,
			PermissionFlagsBits.KickMembers,
			PermissionFlagsBits.ModerateMembers,
			PermissionFlagsBits.MentionEveryone,
		].map((permissions, i) => role(`staff-${i}`, { permissions }));
		expect(restorable({ guildRoles: [...staff, role('b')] })).toEqual(['b']);
	});

	test('keeps roles with ordinary permissions', () => {
		const permissions =
			PermissionFlagsBits.SendMessages | PermissionFlagsBits.ManageMessages | PermissionFlagsBits.AttachFiles;
		expect(restorable({ guildRoles: [role('a', { permissions })] })).toEqual(['a']);
	});

	test('drops ignored roles', () => {
		expect(restorable({ guildRoles: [role('a'), role('b')], ignoredRoleIds: ['a'] })).toEqual(['b']);
	});

	test('drops roles at or above the bot highest role', () => {
		const roles = [
			role('below', { position: BOT_TOP - 1 }),
			role('equal', { position: BOT_TOP }),
			role('above', { position: 20 }),
			role(BOT_ROLE.id, { position: BOT_TOP }),
		];
		expect(restorable({ guildRoles: roles })).toEqual(['below']);
	});

	test('restores nothing when the bot only has @everyone', () => {
		const everyone = { id: EVERYONE, position: 0 };
		expect(restorable({ guildRoles: [role('a', { position: 1 })], botHighestRole: everyone })).toEqual([]);
	});

	test('skips roles the member already holds', () => {
		expect(restorable({ guildRoles: [role('a'), role('b')], heldRoleIds: ['a'] })).toEqual(['b']);
	});

	test('drops duplicate saved IDs', () => {
		expect(restorable({ savedRoleIds: ['a', 'b', 'a'], guildRoles: [role('a'), role('b')] })).toEqual(['a', 'b']);
	});

	test('empty saved list restores nothing', () => {
		expect(restorable({ savedRoleIds: [], guildRoles: [role('a')] })).toEqual([]);
	});
});

describe('filterSavableRoleIds', () => {
	test('keeps ordinary roles', () => {
		expect(filterSavableRoleIds([{ id: 'a', managed: false }], EVERYONE, [])).toEqual(['a']);
	});

	test('drops @everyone, managed and ignored roles', () => {
		const roles = [
			{ id: EVERYONE, managed: false },
			{ id: 'bot', managed: true },
			{ id: 'ignored', managed: false },
			{ id: 'keep', managed: false },
		];
		expect(filterSavableRoleIds(roles, EVERYONE, ['ignored'])).toEqual(['keep']);
	});

	test('a member with only @everyone has nothing to save', () => {
		expect(filterSavableRoleIds([{ id: EVERYONE, managed: false }], EVERYONE, [])).toEqual([]);
	});
});

describe('formatRoleList', () => {
	test('empty list reads as none', () => {
		expect(formatRoleList([])).toBe('*(none)*');
	});

	test('joins mentions with commas', () => {
		expect(formatRoleList(['1', '2'])).toBe('<@&1>, <@&2>');
	});

	test('caps long lists with a count of the rest and never cuts a mention', () => {
		const ids = Array.from({ length: 100 }, (_, i) => String(100000000000000000 + i));
		const text = formatRoleList(ids, 200);
		expect(text.length).toBeLessThanOrEqual(200);
		expect(text).toMatch(/…and \d+ more$/);
		const shown = text.match(/<@&\d+>/g) ?? [];
		const omitted = Number(text.match(/…and (\d+) more$/)?.[1]);
		expect(shown.length + omitted).toBe(ids.length);
		expect(text.replace(/ …and \d+ more$/, '').split(', ')).toEqual(shown);
	});
});
