import { describe, expect, mock, test } from 'bun:test';
import * as schema from '../db/schema.js';

// VerificationUtil imports the MySQL pool, which connects and migrates on import. Stub the pool so the
// pure helpers can be tested without a database; the real table definitions are still needed because
// ModuleUtil derives its defaults from them at import time.
mock.module('./database.js', () => ({ db: {}, schema, closeDatabase: async () => {} }));

const {
	CAPTCHA_ALPHABET,
	CAPTCHA_LENGTH,
	CAPTCHA_MAX_ATTEMPTS,
	CAPTCHA_TTL_MS,
	checkPendingCaptcha,
	createPendingCaptcha,
	generateCaptchaCode,
	hasPendingCaptcha,
	isAccountOldEnough,
	renderCaptcha,
} = await import('./VerificationUtil.js');

describe('generateCaptchaCode', () => {
	test('defaults to five characters', () => {
		expect(generateCaptchaCode()).toHaveLength(CAPTCHA_LENGTH);
		expect(CAPTCHA_LENGTH).toBe(5);
	});

	test('honours a custom length', () => {
		expect(generateCaptchaCode(8)).toHaveLength(8);
	});

	test('alphabet has no look-alike characters', () => {
		for (const ch of '0O1IL') expect(CAPTCHA_ALPHABET).not.toContain(ch);
	});

	test('only emits characters from the alphabet', () => {
		for (let i = 0; i < 200; i++) {
			for (const ch of generateCaptchaCode()) expect(CAPTCHA_ALPHABET).toContain(ch);
		}
	});

	test('does not repeat itself', () => {
		const codes = new Set(Array.from({ length: 50 }, () => generateCaptchaCode()));
		expect(codes.size).toBeGreaterThan(40);
	});
});

describe('renderCaptcha', () => {
	test('returns a PNG', () => {
		const png = renderCaptcha('K7M2Q');
		expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	});
});

describe('pending captcha store', () => {
	const now = 1_700_000_000_000;

	test('a correct answer passes and consumes the code', () => {
		const code = createPendingCaptcha('g1', 'u1', now);
		expect(checkPendingCaptcha('g1', 'u1', code, now)).toEqual({ status: 'ok' });
		expect(checkPendingCaptcha('g1', 'u1', code, now)).toEqual({ status: 'expired' });
	});

	test('comparison ignores case and surrounding whitespace', () => {
		const code = createPendingCaptcha('g1', 'u2', now);
		expect(checkPendingCaptcha('g1', 'u2', ` ${code.toLowerCase()} `, now)).toEqual({ status: 'ok' });
	});

	test('codes are held per guild and user', () => {
		const code = createPendingCaptcha('g1', 'u3', now);
		expect(checkPendingCaptcha('g2', 'u3', code, now)).toEqual({ status: 'expired' });
		expect(checkPendingCaptcha('g1', 'u4', code, now)).toEqual({ status: 'expired' });
		expect(hasPendingCaptcha('g1', 'u3', now)).toBe(true);
	});

	test('three wrong attempts discard the code', () => {
		const code = createPendingCaptcha('g1', 'u5', now);
		expect(checkPendingCaptcha('g1', 'u5', 'AAAAA', now)).toEqual({ status: 'wrong', attemptsLeft: 2 });
		expect(checkPendingCaptcha('g1', 'u5', 'AAAAA', now)).toEqual({ status: 'wrong', attemptsLeft: 1 });
		expect(checkPendingCaptcha('g1', 'u5', 'AAAAA', now)).toEqual({ status: 'exhausted' });
		expect(CAPTCHA_MAX_ATTEMPTS).toBe(3);
		// Even the right answer no longer works: the member has to click Verify again.
		expect(checkPendingCaptcha('g1', 'u5', code, now)).toEqual({ status: 'expired' });
		expect(hasPendingCaptcha('g1', 'u5', now)).toBe(false);
	});

	test('a code expires after five minutes', () => {
		const code = createPendingCaptcha('g1', 'u6', now);
		expect(hasPendingCaptcha('g1', 'u6', now + CAPTCHA_TTL_MS - 1)).toBe(true);
		expect(checkPendingCaptcha('g1', 'u6', code, now + CAPTCHA_TTL_MS)).toEqual({ status: 'expired' });
	});

	test('requesting a new code replaces the old one and resets the attempts', () => {
		createPendingCaptcha('g1', 'u7', now);
		checkPendingCaptcha('g1', 'u7', 'AAAAA', now);
		const fresh = createPendingCaptcha('g1', 'u7', now);
		expect(checkPendingCaptcha('g1', 'u7', 'AAAAA', now)).toEqual({ status: 'wrong', attemptsLeft: 2 });
		expect(checkPendingCaptcha('g1', 'u7', fresh, now)).toEqual({ status: 'ok' });
	});
});

describe('isAccountOldEnough', () => {
	const now = 1_700_000_000_000;
	const day = 86_400_000;

	test('a zero minimum always passes', () => {
		expect(isAccountOldEnough(now, 0, now)).toBe(true);
	});

	test('blocks accounts younger than the minimum', () => {
		expect(isAccountOldEnough(now - 3 * day, 7, now)).toBe(false);
	});

	test('passes at exactly the minimum and beyond', () => {
		expect(isAccountOldEnough(now - 7 * day, 7, now)).toBe(true);
		expect(isAccountOldEnough(now - 30 * day, 7, now)).toBe(true);
	});
});
