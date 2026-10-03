import { describe, expect, mock, test } from 'bun:test';
import * as schema from '../db/schema.js';

// LevelingUtil imports ./database.js, which needs DATABASE_URL and runs migrations on import. The helpers
// under test are pure, so swap in a stub (with the real schema) before loading the module.
mock.module('./database.js', () => ({ db: {}, schema, closeDatabase: async () => {} }));
const { MAX_XP_MULTIPLIER, combineMultipliers, getActiveBoost } = await import('./LevelingUtil.js');

const NOW = 1_800_000_000_000;
const base = { rolePercents: [], channelPercent: null, boostPercent: 100, boostEndsAt: null, now: NOW } as const;

describe('combineMultipliers', () => {
	test('defaults to 1 with no role, channel or boost multipliers', () => {
		expect(combineMultipliers(base)).toBe(1);
	});

	test('uses the highest role percent', () => {
		expect(combineMultipliers({ ...base, rolePercents: [120, 200, 150] })).toBe(2);
	});

	test('a lone role below 100 lowers XP', () => {
		expect(combineMultipliers({ ...base, rolePercents: [50] })).toBe(0.5);
	});

	test('applies the channel percent', () => {
		expect(combineMultipliers({ ...base, channelPercent: 150 })).toBe(1.5);
	});

	test('multiplies role, channel and boost together', () => {
		const factor = combineMultipliers({
			rolePercents: [150],
			channelPercent: 200,
			boostPercent: 120,
			boostEndsAt: NOW + 60_000,
			now: NOW,
		});
		expect(factor).toBeCloseTo(3.6, 10);
	});

	test('applies an active boost', () => {
		expect(combineMultipliers({ ...base, boostPercent: 150, boostEndsAt: NOW + 1 })).toBe(1.5);
	});

	test('ignores an expired boost', () => {
		expect(combineMultipliers({ ...base, boostPercent: 300, boostEndsAt: NOW - 1 })).toBe(1);
	});

	test('a boost ending exactly now is expired', () => {
		expect(combineMultipliers({ ...base, boostPercent: 300, boostEndsAt: NOW })).toBe(1);
	});

	test('ignores a boost with no end time', () => {
		expect(combineMultipliers({ ...base, boostPercent: 300, boostEndsAt: null })).toBe(1);
	});

	test('caps the combined factor at 5x', () => {
		const factor = combineMultipliers({
			rolePercents: [500],
			channelPercent: 500,
			boostPercent: 500,
			boostEndsAt: NOW + 1000,
			now: NOW,
		});
		expect(factor).toBe(MAX_XP_MULTIPLIER);
		expect(MAX_XP_MULTIPLIER).toBe(5);
	});

	test('exactly 5x is allowed', () => {
		expect(combineMultipliers({ ...base, rolePercents: [250], channelPercent: 200 })).toBe(5);
	});

	test('treats unusable percents as neutral', () => {
		expect(
			combineMultipliers({
				rolePercents: [0, -20, Number.NaN],
				channelPercent: Number.POSITIVE_INFINITY,
				boostPercent: Number.NaN,
				boostEndsAt: NOW + 1000,
				now: NOW,
			}),
		).toBe(1);
	});
});

describe('getActiveBoost', () => {
	test('returns the boost while it is running', () => {
		expect(getActiveBoost({ boostPercent: 150, boostEndsAt: NOW + 5000 }, NOW)).toEqual({
			percent: 150,
			endsAt: NOW + 5000,
		});
	});

	test('returns null once expired or when unset', () => {
		expect(getActiveBoost({ boostPercent: 150, boostEndsAt: NOW - 5000 }, NOW)).toBeNull();
		expect(getActiveBoost({ boostPercent: 150, boostEndsAt: null }, NOW)).toBeNull();
	});
});
