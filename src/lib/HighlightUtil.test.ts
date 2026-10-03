import { describe, expect, test } from 'bun:test';
import { RESTJSONErrorCodes } from 'discord.js';
import {
	classifyDmError,
	DmBackoff,
	findHighlightMatches,
	formatQuote,
	type HighlightEntry,
	isMemberMissing,
	isUnknownMemberError,
	isValidKeywordLength,
	MAX_CANDIDATES_CHECKED_PER_MESSAGE,
	MAX_RECIPIENTS_PER_MESSAGE,
	MISSING_MEMBER_COOLDOWN_MS,
	markMemberMissing,
	normalizeKeyword,
	RecencyTracker,
	RecipientCap,
	SendBudget,
} from './HighlightUtil.js';

const AUTHOR = 'author';
const entry = (userId: string, keyword: string): HighlightEntry => ({ userId, keyword });
const ids = (content: string, entries: HighlightEntry[], authorId = AUTHOR) =>
	findHighlightMatches(content, entries, authorId).map((m) => m.userId);

describe('findHighlightMatches', () => {
	test('matches a whole word', () => {
		expect(ids('anyone up for minecraft tonight?', [entry('u1', 'minecraft')])).toEqual(['u1']);
		expect(findHighlightMatches('play minecraft', [entry('u1', 'minecraft')], AUTHOR)).toEqual([
			{ userId: 'u1', keyword: 'minecraft' },
		]);
	});

	test('does not match inside a longer word', () => {
		expect(ids('minecrafting is fun', [entry('u1', 'minecraft')])).toEqual([]);
		expect(ids('superminecraft', [entry('u1', 'minecraft')])).toEqual([]);
		expect(ids('cat_dog', [entry('u1', 'cat')])).toEqual([]);
		expect(ids('cat2', [entry('u1', 'cat')])).toEqual([]);
	});

	test('matches next to punctuation, at the edges and across lines', () => {
		expect(ids('hello, minecraft!', [entry('u1', 'minecraft')])).toEqual(['u1']);
		expect(ids('minecraft', [entry('u1', 'minecraft')])).toEqual(['u1']);
		expect(ids('(minecraft)', [entry('u1', 'minecraft')])).toEqual(['u1']);
		expect(ids('line one\nminecraft\nline three', [entry('u1', 'minecraft')])).toEqual(['u1']);
	});

	test('is case-insensitive', () => {
		expect(ids('MineCraft is great', [entry('u1', 'minecraft')])).toEqual(['u1']);
		expect(ids('minecraft is great', [entry('u1', 'MINECRAFT')])).toEqual(['u1']);
	});

	test('matches multi-word keywords', () => {
		expect(ids('who wants to play Hello World?', [entry('u1', 'hello world')])).toEqual(['u1']);
		expect(ids('hello there world', [entry('u1', 'hello world')])).toEqual([]);
	});

	test('treats regex special characters literally', () => {
		expect(ids('I like c++ a lot', [entry('u1', 'c++')])).toEqual(['u1']);
		expect(ids('I like c a lot', [entry('u1', 'c++')])).toEqual([]);
		expect(ids('learning .net today', [entry('u1', '.net')])).toEqual(['u1']);
		expect(ids('learning xnet today', [entry('u1', '.net')])).toEqual([]);
		expect(ids('what? really', [entry('u1', 'what?')])).toEqual(['u1']);
		expect(ids('price is $5 (ok)', [entry('u1', '$5'), entry('u2', '(ok)')])).toEqual(['u1', 'u2']);
		expect(ids('a|b', [entry('u1', 'a|b')])).toEqual(['u1']);
		expect(ids('just b', [entry('u1', 'a|b')])).toEqual([]);
		expect(ids('anything', [entry('u1', '.*')])).toEqual([]);
		expect(ids('back\\slash and [brackets]', [entry('u1', 'back\\slash'), entry('u2', '[brackets]')])).toEqual([
			'u1',
			'u2',
		]);
	});

	test('handles non-ASCII letters as word characters', () => {
		expect(ids('ein café am Morgen', [entry('u1', 'café')])).toEqual(['u1']);
		expect(ids('cafés sind gut', [entry('u1', 'café')])).toEqual([]);
		expect(ids('こんにちは world', [entry('u1', 'world')])).toEqual(['u1']);
	});

	test('never matches the author', () => {
		expect(ids('minecraft', [entry(AUTHOR, 'minecraft')])).toEqual([]);
		expect(ids('minecraft', [entry(AUTHOR, 'minecraft'), entry('u1', 'minecraft')])).toEqual(['u1']);
	});

	test('returns at most one match per user, using the first matching keyword', () => {
		const entries = [entry('u1', 'foo'), entry('u1', 'bar'), entry('u2', 'bar'), entry('u1', 'baz')];
		const matches = findHighlightMatches('foo bar baz', entries, AUTHOR);
		expect(matches).toEqual([
			{ userId: 'u1', keyword: 'foo' },
			{ userId: 'u2', keyword: 'bar' },
		]);
	});

	test('skips keywords that do not match and still finds later ones for the same user', () => {
		const matches = findHighlightMatches('only bar here', [entry('u1', 'foo'), entry('u1', 'bar')], AUTHOR);
		expect(matches).toEqual([{ userId: 'u1', keyword: 'bar' }]);
	});

	test('returns every distinct member whose keyword matches', () => {
		expect(
			ids('minecraft and valorant', [entry('u1', 'minecraft'), entry('u2', 'valorant'), entry('u3', 'chess')]),
		).toEqual(['u1', 'u2']);
	});

	test('returns nothing for empty content, no entries or an empty keyword', () => {
		expect(ids('', [entry('u1', 'minecraft')])).toEqual([]);
		expect(ids('minecraft', [])).toEqual([]);
		expect(ids('minecraft', [entry('u1', '')])).toEqual([]);
		expect(ids('minecraft', [entry('u1', '   ')])).toEqual([]);
	});

	test('returns the same result on repeated calls (shared patterns are stateless)', () => {
		const entries = [entry('u1', 'minecraft')];
		for (let i = 0; i < 3; i++) expect(ids('minecraft', entries)).toEqual(['u1']);
	});
});

describe('normalizeKeyword / isValidKeywordLength', () => {
	test('trims and lowercases', () => {
		expect(normalizeKeyword('  MineCraft ')).toBe('minecraft');
	});

	test('accepts 2-32 characters only', () => {
		expect(isValidKeywordLength('a')).toBe(false);
		expect(isValidKeywordLength('ab')).toBe(true);
		expect(isValidKeywordLength('a'.repeat(32))).toBe(true);
		expect(isValidKeywordLength('a'.repeat(33))).toBe(false);
	});
});

describe('formatQuote', () => {
	test('quotes every line', () => {
		expect(formatQuote('one\ntwo')).toBe('> one\n> two');
	});

	test('truncates to 500 characters with an ellipsis', () => {
		const quoted = formatQuote('a'.repeat(600));
		expect(quoted).toBe(`> ${'a'.repeat(500)}…`);
		expect(formatQuote('a'.repeat(500))).toBe(`> ${'a'.repeat(500)}`);
	});

	test('does not split an emoji surrogate pair', () => {
		const quoted = formatQuote('😀'.repeat(600));
		expect(quoted).toBe(`> ${'😀'.repeat(500)}…`);
	});
});

describe('RecencyTracker', () => {
	test('reports keys touched within the window only', () => {
		const tracker = new RecencyTracker(1_000, 100);
		tracker.touch('a', 0);
		expect(tracker.isRecent('a', 999)).toBe(true);
		expect(tracker.isRecent('a', 1_000)).toBe(false);
		expect(tracker.isRecent('missing', 0)).toBe(false);
	});

	test('a later touch extends the window', () => {
		const tracker = new RecencyTracker(1_000, 100);
		tracker.touch('a', 0);
		tracker.touch('a', 900);
		expect(tracker.isRecent('a', 1_500)).toBe(true);
	});

	test('prunes expired entries as new ones arrive', () => {
		const tracker = new RecencyTracker(1_000, 100);
		for (let i = 0; i < 10; i++) tracker.touch(`k${i}`, i);
		expect(tracker.size).toBe(10);
		tracker.touch('late', 5_000);
		expect(tracker.size).toBe(1);
	});

	test('stays under its hard cap, evicting the oldest first', () => {
		const tracker = new RecencyTracker(60_000, 3);
		for (let i = 0; i < 10; i++) tracker.touch(`k${i}`, i);
		expect(tracker.size).toBe(3);
		expect(tracker.isRecent('k9', 10)).toBe(true);
		expect(tracker.isRecent('k0', 10)).toBe(false);
	});
});

describe('RecencyTracker.forget', () => {
	test('removes a key so it is no longer recent', () => {
		const tracker = new RecencyTracker(1_000, 100);
		tracker.touch('a', 0);
		tracker.forget('a');
		expect(tracker.isRecent('a', 1)).toBe(false);
		expect(tracker.size).toBe(0);
		tracker.forget('missing');
	});
});

describe('RecipientCap', () => {
	test('defaults to 10 recipients per message', () => {
		expect(MAX_RECIPIENTS_PER_MESSAGE).toBe(10);
		const cap = new RecipientCap();
		let granted = 0;
		for (let i = 0; i < 500; i++) if (cap.take()) granted++;
		expect(granted).toBe(10);
		expect(cap.taken).toBe(10);
		expect(cap.isFull).toBe(true);
	});

	test('hands out slots until the cap is reached, then refuses', () => {
		const cap = new RecipientCap(2);
		expect(cap.isFull).toBe(false);
		expect(cap.take()).toBe(true);
		expect(cap.take()).toBe(true);
		expect(cap.isFull).toBe(true);
		expect(cap.take()).toBe(false);
		expect(cap.taken).toBe(2);
	});

	test('halt closes the gate for the rest of the message', () => {
		const cap = new RecipientCap(10);
		expect(cap.take()).toBe(true);
		cap.halt();
		expect(cap.isFull).toBe(true);
		expect(cap.take()).toBe(false);
		expect(cap.taken).toBe(1);
	});

	test('picks recipients in the order they are asked', () => {
		const cap = new RecipientCap(3);
		const candidates = ['u1', 'u2', 'u3', 'u4', 'u5'];
		const chosen: string[] = [];
		for (const id of candidates) {
			if (cap.isFull) break;
			if (cap.take()) chosen.push(id);
		}
		expect(chosen).toEqual(['u1', 'u2', 'u3']);
	});
});

describe('RecipientCap check limit', () => {
	test('defaults to checking 30 candidates per message', () => {
		expect(MAX_CANDIDATES_CHECKED_PER_MESSAGE).toBe(30);
		const cap = new RecipientCap();
		let checked = 0;
		while (!cap.isFull) {
			cap.beginCheck();
			checked++;
		}
		expect(checked).toBe(30);
		expect(cap.checkedCount).toBe(30);
		expect(cap.taken).toBe(0);
		expect(cap.take()).toBe(false);
	});

	test('checks that find nobody eligible stop at the limit, taken recipients stop at the cap', () => {
		const cap = new RecipientCap(10, 4);
		for (let i = 0; i < 3; i++) cap.beginCheck();
		expect(cap.isFull).toBe(false);
		expect(cap.take()).toBe(true);
		cap.beginCheck();
		expect(cap.isFull).toBe(true);

		const sends = new RecipientCap(2, 100);
		for (let i = 0; i < 5 && !sends.isFull; i++) {
			sends.beginCheck();
			sends.take();
		}
		expect(sends.taken).toBe(2);
		expect(sends.checkedCount).toBe(2);
	});
});

describe('missing member cache', () => {
	test('remembers a departed member for 10 minutes', () => {
		expect(MISSING_MEMBER_COOLDOWN_MS).toBe(600_000);
		markMemberMissing('g-missing', 'u1', 1_000);
		expect(isMemberMissing('g-missing', 'u1', 1_001)).toBe(true);
		expect(isMemberMissing('g-missing', 'u1', 1_000 + MISSING_MEMBER_COOLDOWN_MS - 1)).toBe(true);
		expect(isMemberMissing('g-missing', 'u1', 1_000 + MISSING_MEMBER_COOLDOWN_MS)).toBe(false);
	});

	test('is keyed by guild and member', () => {
		markMemberMissing('g-a', 'u2', 0);
		expect(isMemberMissing('g-a', 'u2', 1)).toBe(true);
		expect(isMemberMissing('g-b', 'u2', 1)).toBe(false);
		expect(isMemberMissing('g-a', 'u3', 1)).toBe(false);
	});
});

describe('isUnknownMemberError', () => {
	test('is true for 10007 only', () => {
		expect(RESTJSONErrorCodes.UnknownMember).toBe(10007);
		expect(isUnknownMemberError({ code: 10007 })).toBe(true);
		expect(isUnknownMemberError({ code: 10013 })).toBe(false);
		expect(isUnknownMemberError({ code: '10007' })).toBe(false);
		expect(isUnknownMemberError(new Error('boom'))).toBe(false);
		expect(isUnknownMemberError(null)).toBe(false);
	});
});

describe('SendBudget', () => {
	const WINDOW = 10_000;

	test('allows `limit` sends per window and then refuses', () => {
		const budget = new SendBudget(5, WINDOW, 100);
		for (let i = 0; i < 5; i++) expect(budget.tryConsume('u1', i)).toBe(true);
		expect(budget.hasBudget('u1', 5)).toBe(false);
		expect(budget.tryConsume('u1', 5)).toBe(false);
		expect(budget.tryConsume('u1', 9_999)).toBe(false);
	});

	test('budgets are per key', () => {
		const budget = new SendBudget(1, WINDOW, 100);
		expect(budget.tryConsume('u1', 0)).toBe(true);
		expect(budget.tryConsume('u1', 1)).toBe(false);
		expect(budget.tryConsume('u2', 1)).toBe(true);
	});

	test('the window slides: old sends stop counting one by one', () => {
		const budget = new SendBudget(2, WINDOW, 100);
		expect(budget.tryConsume('u1', 0)).toBe(true);
		expect(budget.tryConsume('u1', 6_000)).toBe(true);
		expect(budget.tryConsume('u1', 9_000)).toBe(false);
		// The send at t=0 expired, the one at t=6000 still counts.
		expect(budget.tryConsume('u1', 10_000)).toBe(true);
		expect(budget.tryConsume('u1', 10_001)).toBe(false);
		// Everything expired.
		expect(budget.hasBudget('u1', 30_000)).toBe(true);
	});

	test('hasBudget does not spend anything', () => {
		const budget = new SendBudget(1, WINDOW, 100);
		for (let i = 0; i < 5; i++) expect(budget.hasBudget('u1', 0)).toBe(true);
		expect(budget.size).toBe(0);
		expect(budget.tryConsume('u1', 0)).toBe(true);
	});

	test('a refunded send does not count against the budget', () => {
		const budget = new SendBudget(2, WINDOW, 100);
		expect(budget.tryConsume('u1', 100)).toBe(true);
		expect(budget.tryConsume('u1', 200)).toBe(true);
		expect(budget.tryConsume('u1', 300)).toBe(false);
		budget.refund('u1', 200);
		expect(budget.tryConsume('u1', 300)).toBe(true);
		expect(budget.tryConsume('u1', 301)).toBe(false);
	});

	test('refunding an unknown key or timestamp is a no-op', () => {
		const budget = new SendBudget(1, WINDOW, 100);
		budget.refund('nobody', 0);
		expect(budget.tryConsume('u1', 100)).toBe(true);
		budget.refund('u1', 999);
		expect(budget.tryConsume('u1', 101)).toBe(false);
	});

	test('a fully refunded key leaves no entry behind', () => {
		const budget = new SendBudget(2, WINDOW, 100);
		budget.tryConsume('u1', 0);
		budget.refund('u1', 0);
		expect(budget.size).toBe(0);
	});

	test('prunes expired keys as new sends arrive', () => {
		const budget = new SendBudget(5, WINDOW, 100);
		for (let i = 0; i < 10; i++) budget.tryConsume(`k${i}`, i);
		expect(budget.size).toBe(10);
		budget.tryConsume('late', 50_000);
		expect(budget.size).toBe(1);
	});

	test('stays under its hard cap, evicting the oldest key first', () => {
		const budget = new SendBudget(1, 60_000, 3);
		for (let i = 0; i < 10; i++) budget.tryConsume(`k${i}`, i);
		expect(budget.size).toBe(3);
		expect(budget.hasBudget('k9', 10)).toBe(false);
		expect(budget.hasBudget('k0', 10)).toBe(true);
	});

	test('keeps at most `limit` timestamps per key', () => {
		const budget = new SendBudget(3, WINDOW, 100);
		for (let i = 0; i < 50; i++) budget.tryConsume('u1', i);
		budget.refund('u1', 0);
		budget.refund('u1', 1);
		budget.refund('u1', 2);
		// Only the first three sends were ever recorded, so the key is empty again.
		expect(budget.size).toBe(0);
	});
});

describe('DmBackoff', () => {
	test('is not paused until told to pause', () => {
		expect(new DmBackoff().isPaused(0)).toBe(false);
	});

	test('pauses for the given duration', () => {
		const backoff = new DmBackoff();
		expect(backoff.pause(60_000, 1_000)).toBe(true);
		expect(backoff.isPaused(1_001)).toBe(true);
		expect(backoff.isPaused(60_999)).toBe(true);
		expect(backoff.isPaused(61_000)).toBe(false);
	});

	test('pausing during a pause reports it was already paused and never shortens it', () => {
		const backoff = new DmBackoff();
		expect(backoff.pause(60_000, 0)).toBe(true);
		expect(backoff.pause(10_000, 5_000)).toBe(false);
		expect(backoff.isPaused(30_000)).toBe(true);
		expect(backoff.pause(60_000, 40_000)).toBe(false);
		expect(backoff.isPaused(99_999)).toBe(true);
		expect(backoff.isPaused(100_000)).toBe(false);
	});

	test('a new pause after the old one ended counts as a new pause', () => {
		const backoff = new DmBackoff();
		backoff.pause(1_000, 0);
		expect(backoff.pause(1_000, 5_000)).toBe(true);
	});
});

describe('classifyDmError', () => {
	test('maps 50007 to closed and 40003 to too-fast', () => {
		expect(RESTJSONErrorCodes.CannotSendMessagesToThisUser).toBe(50007);
		expect(RESTJSONErrorCodes.OpeningDirectMessagesTooFast).toBe(40003);
		expect(classifyDmError({ code: 50007 })).toBe('closed');
		expect(classifyDmError({ code: 40003 })).toBe('too-fast');
	});

	test('everything else is other', () => {
		expect(classifyDmError({ code: 10003 })).toBe('other');
		expect(classifyDmError({ code: 'ECONNRESET' })).toBe('other');
		expect(classifyDmError(new Error('boom'))).toBe('other');
		expect(classifyDmError(null)).toBe('other');
		expect(classifyDmError(undefined)).toBe('other');
		expect(classifyDmError('50007')).toBe('other');
	});
});
