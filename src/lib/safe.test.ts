import { describe, expect, test } from 'bun:test';
import { isDuplicateKeyError, safeJsonParse } from './safe.js';

describe('safeJsonParse', () => {
	test('parses valid JSON', () => {
		expect(safeJsonParse('{"a":1}', {})).toEqual({ a: 1 });
		expect(safeJsonParse('[1,2]', [] as number[])).toEqual([1, 2]);
	});

	test('returns fallback for invalid JSON', () => {
		expect(safeJsonParse('{nope', { ok: false })).toEqual({ ok: false });
	});

	test('returns fallback for null, undefined and empty input', () => {
		expect(safeJsonParse(null, 'x')).toBe('x');
		expect(safeJsonParse(undefined, 'x')).toBe('x');
		expect(safeJsonParse('', 'x')).toBe('x');
	});

	test('returns fallback when parsed value is null', () => {
		expect(safeJsonParse('null', { d: 1 })).toEqual({ d: 1 });
	});

	test('returns array fallback when parsed value is not an array', () => {
		expect(safeJsonParse('{"a":1}', [] as unknown[])).toEqual([]);
	});
});

describe('isDuplicateKeyError', () => {
	test('detects direct ER_DUP_ENTRY code', () => {
		expect(isDuplicateKeyError({ code: 'ER_DUP_ENTRY' })).toBe(true);
	});

	test('detects errno 1062', () => {
		expect(isDuplicateKeyError({ errno: 1062 })).toBe(true);
	});

	test('detects nested cause (Drizzle wrapping)', () => {
		const inner = Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY', errno: 1062 });
		const wrapped = new Error('Failed query', { cause: inner });
		expect(isDuplicateKeyError(wrapped)).toBe(true);
	});

	test('false for unrelated errors', () => {
		expect(isDuplicateKeyError(new Error('boom'))).toBe(false);
		expect(isDuplicateKeyError({ code: 'ER_NO_SUCH_TABLE', errno: 1146 })).toBe(false);
		expect(isDuplicateKeyError(null)).toBe(false);
		expect(isDuplicateKeyError(undefined)).toBe(false);
	});
});
