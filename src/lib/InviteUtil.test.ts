import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { Collection, type Guild, type GuildMember, type Invite } from 'discord.js';
import {
	countInviteRows,
	FAKE_ACCOUNT_AGE_MS,
	getJoinInvite,
	inviteCache,
	isFakeAccount,
	JOIN_INVITE_TTL_MS,
	selectRewardRoleIds,
} from './InviteUtil.js';

describe('isFakeAccount', () => {
	const joined = 1_800_000_000_000;

	test('account younger than 7 days is fake', () => {
		expect(isFakeAccount(joined - FAKE_ACCOUNT_AGE_MS + 1, joined)).toBe(true);
		expect(isFakeAccount(joined, joined)).toBe(true);
	});

	test('account exactly 7 days old or older is not fake', () => {
		expect(isFakeAccount(joined - FAKE_ACCOUNT_AGE_MS, joined)).toBe(false);
		expect(isFakeAccount(joined - 365 * 24 * 60 * 60 * 1000, joined)).toBe(false);
	});
});

describe('countInviteRows', () => {
	test('no rows is all zero', () => {
		expect(countInviteRows([])).toEqual({ joins: 0, left: 0, fake: 0, effective: 0 });
	});

	test('effective counts only rows that are still open and not fake', () => {
		const counts = countInviteRows([
			{ leftAt: null, fake: false }, // effective
			{ leftAt: null, fake: false }, // effective
			{ leftAt: 123, fake: false }, // left
			{ leftAt: null, fake: true }, // fake, still here
			{ leftAt: 456, fake: true }, // fake and left
		]);
		expect(counts).toEqual({ joins: 5, left: 2, fake: 2, effective: 2 });
	});
});

describe('selectRewardRoleIds', () => {
	const rewards = [
		{ invites: 5, roleId: 'a' },
		{ invites: 10, roleId: 'b' },
		{ invites: 10, roleId: 'c' },
		{ invites: 25, roleId: 'd' },
	];

	test('grants every reward at or below the effective count', () => {
		expect(selectRewardRoleIds(10, rewards, () => false)).toEqual(['a', 'b', 'c']);
		expect(selectRewardRoleIds(4, rewards, () => false)).toEqual([]);
	});

	test('skips roles the inviter already has and deduplicates', () => {
		expect(selectRewardRoleIds(30, rewards, (id) => id === 'b')).toEqual(['a', 'c', 'd']);
		expect(
			selectRewardRoleIds(
				10,
				[
					{ invites: 1, roleId: 'x' },
					{ invites: 5, roleId: 'x' },
				],
				() => false,
			),
		).toEqual(['x']);
	});
});

describe('getJoinInvite', () => {
	let nextGuild = 0;
	let fetchCalls = 0;

	/** A guild whose single invite gains one use per fetch, so every detection run sees a new use. */
	function fakeGuild() {
		const guildId = `guild-${nextGuild++}`;
		inviteCache.set(guildId, new Map([['abc', 1]]));
		let uses = 1;
		return {
			id: guildId,
			invites: {
				fetch: async () => {
					fetchCalls++;
					uses++;
					const invite = {
						code: 'abc',
						uses,
						inviterId: 'inviter-1',
						inviter: { username: 'inviter' },
					} as unknown as Invite;
					return new Collection<string, Invite>([['abc', invite]]);
				},
			},
		} as unknown as Guild;
	}

	function fakeMember(userId: string, guild = fakeGuild(), joinedTimestamp: number | null = 1_800_000_000_000) {
		return { id: userId, guild, joinedTimestamp } as unknown as GuildMember;
	}

	afterEach(() => {
		fetchCalls = 0;
	});

	test('two calls for one join share a single detection', async () => {
		const member = fakeMember('user-1');
		const [first, second] = await Promise.all([getJoinInvite(member), getJoinInvite(member)]);
		const third = await getJoinInvite(member);

		expect(fetchCalls).toBe(1);
		expect(first).toEqual({ code: 'abc', inviterId: 'inviter-1', inviterUsername: 'inviter', uses: 2 });
		expect(second).toBe(first);
		expect(third).toBe(first);
	});

	test('a rejoin within the TTL detects again instead of reusing the previous join', async () => {
		const guild = fakeGuild();
		const firstJoin = await getJoinInvite(fakeMember('user-rejoin', guild, 1_800_000_000_000));
		const secondJoin = await getJoinInvite(fakeMember('user-rejoin', guild, 1_800_000_030_000));

		expect(fetchCalls).toBe(2);
		expect(firstJoin?.uses).toBe(2);
		expect(secondJoin?.uses).toBe(3);
		// The same join is still shared.
		expect(await getJoinInvite(fakeMember('user-rejoin', guild, 1_800_000_030_000))).toBe(secondJoin);
		expect(fetchCalls).toBe(2);
	});

	test('different members detect separately', async () => {
		const a = fakeMember('user-a');
		const b = fakeMember('user-b');
		await getJoinInvite(a);
		await getJoinInvite(b);
		expect(fetchCalls).toBe(2);
	});

	test('the memoized result expires after the TTL', async () => {
		const member = fakeMember('user-ttl');
		const realNow = Date.now();
		const now = spyOn(Date, 'now');
		try {
			now.mockReturnValue(realNow);
			await getJoinInvite(member);
			now.mockReturnValue(realNow + JOIN_INVITE_TTL_MS - 1);
			await getJoinInvite(member);
			expect(fetchCalls).toBe(1);

			now.mockReturnValue(realNow + JOIN_INVITE_TTL_MS + 1);
			await getJoinInvite(member);
			expect(fetchCalls).toBe(2);
		} finally {
			now.mockRestore();
		}
	});
});
