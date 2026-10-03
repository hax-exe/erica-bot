import { describe, expect, test } from 'bun:test';
import { type GuildBasedChannel, type GuildMember, PermissionFlagsBits } from 'discord.js';
import {
	ANNOUNCE_COLOR_CHOICES,
	ANNOUNCE_COLOR_PRESETS,
	advanceNextRun,
	botPostPermissionError,
	buildAnnouncementPing,
	canSendAnnouncePing,
	checkScheduleAuthority,
	missingBotPostPermissions,
	PENDING_SCHEDULE_TTL_MS,
	type PendingSchedule,
	resolveAnnounceColor,
	storePendingSchedule,
	takePendingSchedule,
} from './AnnouncementUtil.js';

const MIN = 60_000;
const HOUR = 60 * MIN;

describe('advanceNextRun', () => {
	test('a run sent on time moves exactly one interval ahead', () => {
		expect(advanceNextRun(1_000_000, HOUR, 1_000_000)).toBe(1_000_000 + HOUR);
	});

	test('a slightly late run still moves one interval ahead', () => {
		expect(advanceNextRun(1_000_000, HOUR, 1_000_000 + 30_000)).toBe(1_000_000 + HOUR);
	});

	test('missed runs are skipped in whole intervals', () => {
		const next = advanceNextRun(0, HOUR, 2.5 * HOUR);
		expect(next).toBe(3 * HOUR);
	});

	test('a run exactly on an interval boundary lands one interval past now', () => {
		expect(advanceNextRun(0, HOUR, 2 * HOUR)).toBe(3 * HOUR);
	});

	test('the result is always after now and on the original cadence', () => {
		const start = 1_700_000_000_000;
		const interval = 10 * MIN;
		for (const lateBy of [0, 1, interval - 1, interval, interval + 1, 7 * interval + 123, 1_000 * interval]) {
			const now = start + lateBy;
			const next = advanceNextRun(start, interval, now);
			expect(next).toBeGreaterThan(now);
			expect(next - interval).toBeLessThanOrEqual(now);
			expect((next - start) % interval).toBe(0);
		}
	});

	test('always advances at least one interval, even if not yet due', () => {
		expect(advanceNextRun(5_000, HOUR, 0)).toBe(5_000 + HOUR);
	});

	test('rejects a non-positive interval', () => {
		expect(() => advanceNextRun(0, 0, 0)).toThrow(RangeError);
		expect(() => advanceNextRun(0, -5, 0)).toThrow(RangeError);
		expect(() => advanceNextRun(0, Number.NaN, 0)).toThrow(RangeError);
	});
});

describe('resolveAnnounceColor', () => {
	test('known presets resolve to their color', () => {
		expect(resolveAnnounceColor('red')).toBe(0xed4245);
		expect(resolveAnnounceColor('teal')).toBe(0x1abc9c);
	});

	test('unknown, empty and prototype keys fall back to blue', () => {
		expect(resolveAnnounceColor('nope')).toBe(ANNOUNCE_COLOR_PRESETS.blue);
		expect(resolveAnnounceColor(null)).toBe(ANNOUNCE_COLOR_PRESETS.blue);
		expect(resolveAnnounceColor('constructor')).toBe(ANNOUNCE_COLOR_PRESETS.blue);
	});

	test('choices keep the original names and order', () => {
		expect(ANNOUNCE_COLOR_CHOICES).toEqual([
			{ name: 'Blue', value: 'blue' },
			{ name: 'Green', value: 'green' },
			{ name: 'Yellow', value: 'yellow' },
			{ name: 'Red', value: 'red' },
			{ name: 'Purple', value: 'purple' },
			{ name: 'Teal', value: 'teal' },
			{ name: 'White', value: 'white' },
		]);
	});
});

describe('buildAnnouncementPing', () => {
	const guildId = '100';

	test('@everyone uses the literal text', () => {
		expect(buildAnnouncementPing(guildId, 'r', guildId)).toEqual({
			content: '@everyone',
			allowedMentions: { parse: ['everyone'] },
		});
	});

	test('a role ping allows only that role', () => {
		expect(buildAnnouncementPing(guildId, 'r', '200')).toEqual({
			content: '<@&200>',
			allowedMentions: { roles: ['200'] },
		});
	});

	test('a user ping allows only that user', () => {
		expect(buildAnnouncementPing(guildId, 'u', '300')).toEqual({
			content: '<@300>',
			allowedMentions: { users: ['300'] },
		});
	});

	test('no ping for none / missing id', () => {
		expect(buildAnnouncementPing(guildId, 'none', '')).toBeUndefined();
		expect(buildAnnouncementPing(guildId, null, null)).toBeUndefined();
		expect(buildAnnouncementPing(guildId, 'r', '')).toBeUndefined();
	});
});

describe('canSendAnnouncePing', () => {
	const guildId = '100';
	const roles = new Map([
		['200', { mentionable: true }],
		['201', { mentionable: false }],
	]);
	const member = { guild: { id: guildId, roles: { cache: roles } } } as unknown as GuildMember;
	const channelWith = (mentionEveryone: boolean | null) =>
		({
			permissionsFor: () => (mentionEveryone === null ? null : { has: () => mentionEveryone }),
		}) as unknown as GuildBasedChannel;

	test('users and mentionable or uncached roles need nothing', () => {
		expect(canSendAnnouncePing(member, channelWith(false), 'u', '300')).toBe(true);
		expect(canSendAnnouncePing(member, channelWith(false), 'r', '200')).toBe(true);
		expect(canSendAnnouncePing(member, channelWith(false), 'r', '999')).toBe(true);
		expect(canSendAnnouncePing(member, channelWith(false), null, null)).toBe(true);
	});

	test('@everyone and non-mentionable roles need Mention Everyone', () => {
		expect(canSendAnnouncePing(member, channelWith(false), 'r', guildId)).toBe(false);
		expect(canSendAnnouncePing(member, channelWith(false), 'r', '201')).toBe(false);
		expect(canSendAnnouncePing(member, channelWith(null), 'r', '201')).toBe(false);
		expect(canSendAnnouncePing(member, channelWith(true), 'r', guildId)).toBe(true);
		expect(canSendAnnouncePing(member, channelWith(true), 'r', '201')).toBe(true);
	});
});

describe('missingBotPostPermissions', () => {
	const me = {} as unknown as GuildMember;
	const channelWith = (granted: bigint[] | null, thread = false) =>
		({
			id: '400',
			isThread: () => thread,
			permissionsFor: () => (granted === null ? null : { has: (flag: bigint) => granted.includes(flag) }),
		}) as unknown as GuildBasedChannel;

	test('nothing missing with View Channel and Send Messages', () => {
		const channel = channelWith([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]);
		expect(missingBotPostPermissions(channel, me)).toEqual([]);
		expect(botPostPermissionError(channel, me)).toBeNull();
	});

	test('reports each missing permission by name', () => {
		expect(missingBotPostPermissions(channelWith([PermissionFlagsBits.ViewChannel]), me)).toEqual(['Send Messages']);
		expect(missingBotPostPermissions(channelWith([PermissionFlagsBits.SendMessages]), me)).toEqual(['View Channel']);
		expect(missingBotPostPermissions(channelWith([]), me)).toEqual(['View Channel', 'Send Messages']);
	});

	test('threads need Send Messages in Threads instead of Send Messages', () => {
		const ok = channelWith([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessagesInThreads], true);
		expect(missingBotPostPermissions(ok, me)).toEqual([]);
		const wrong = channelWith([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages], true);
		expect(missingBotPostPermissions(wrong, me)).toEqual(['Send Messages in Threads']);
	});

	test('an unresolved bot member or channel counts as missing everything', () => {
		expect(missingBotPostPermissions(channelWith([]), null)).toEqual(['View Channel', 'Send Messages']);
		expect(missingBotPostPermissions(channelWith(null), me)).toEqual(['View Channel', 'Send Messages']);
	});

	test('the error names the channel and the missing permissions', () => {
		const message = botPostPermissionError(channelWith([]), me);
		expect(message).toContain('<#400>');
		expect(message).toContain('**View Channel** and **Send Messages**');
	});
});

describe('checkScheduleAuthority', () => {
	const guildId = '100';
	const roles = new Map([['201', { mentionable: false }]]);
	const memberWith = (manageGuild: boolean) =>
		({
			guild: { id: guildId, roles: { cache: roles } },
			permissions: { has: (flag: bigint) => manageGuild && flag === PermissionFlagsBits.ManageGuild },
		}) as unknown as GuildMember;
	const channelWith = (mentionEveryone: boolean) =>
		({ permissionsFor: () => ({ has: () => mentionEveryone }) }) as unknown as GuildBasedChannel;

	test('a creator who left blocks the send', () => {
		const result = checkScheduleAuthority(null, channelWith(true), null, null);
		expect(result.ok).toBe(false);
		expect(checkScheduleAuthority(undefined, channelWith(true), 'r', guildId).ok).toBe(false);
	});

	test('a creator without Manage Server blocks the send', () => {
		const result = checkScheduleAuthority(memberWith(false), channelWith(true), 'r', guildId);
		expect(result).toEqual({ ok: false, reason: 'its creator no longer has the Manage Server permission.' });
	});

	test('a creator with Manage Server may send, with the ping when the rule passes', () => {
		expect(checkScheduleAuthority(memberWith(true), channelWith(true), 'r', guildId)).toEqual({
			ok: true,
			pingAllowed: true,
		});
		expect(checkScheduleAuthority(memberWith(true), channelWith(false), 'u', '300')).toEqual({
			ok: true,
			pingAllowed: true,
		});
	});

	test('losing the ping permission sends without the ping', () => {
		expect(checkScheduleAuthority(memberWith(true), channelWith(false), 'r', guildId)).toEqual({
			ok: true,
			pingAllowed: false,
		});
		expect(checkScheduleAuthority(memberWith(true), channelWith(false), 'r', '201')).toEqual({
			ok: true,
			pingAllowed: false,
		});
	});
});

describe('pending schedules', () => {
	const pending = (userId: string): PendingSchedule => ({
		userId,
		guildId: '100',
		channelId: '400',
		delayMs: HOUR,
		intervalMs: null,
		pingType: null,
		pingId: null,
		color: 'blue',
	});

	test('store then take returns the options once', () => {
		const nonce = storePendingSchedule(pending('u1'), 0);
		expect(nonce).toMatch(/^[0-9a-f]{8}$/);
		expect(takePendingSchedule('u1', nonce, 1_000)).toEqual(pending('u1'));
		expect(takePendingSchedule('u1', nonce, 1_000)).toBeNull();
	});

	test('wrong user or wrong nonce gets nothing', () => {
		const nonce = storePendingSchedule(pending('u2'), 0);
		expect(takePendingSchedule('someone-else', nonce, 0)).toBeNull();
		expect(takePendingSchedule('u2', 'not-a-nonce', 0)).toBeNull();
		expect(takePendingSchedule('u2', nonce, 0)).not.toBeNull();
	});

	test('a newer form replaces the older one', () => {
		const first = storePendingSchedule(pending('u3'), 0);
		const second = storePendingSchedule({ ...pending('u3'), color: 'red' }, 0);
		if (first !== second) expect(takePendingSchedule('u3', first, 0)).toBeNull();
		expect(takePendingSchedule('u3', second, 0)?.color).toBe('red');
	});

	test('expires after 15 minutes', () => {
		const nonce = storePendingSchedule(pending('u4'), 0);
		expect(takePendingSchedule('u4', nonce, PENDING_SCHEDULE_TTL_MS)).toBeNull();
	});
});
