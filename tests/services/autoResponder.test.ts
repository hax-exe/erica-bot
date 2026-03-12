import { describe, it, expect } from 'vitest';
import { matchesTrigger, safeRegexTest, isRegexSafe } from '../../src/services/autoResponder.js';

// Test cases for matchesTrigger against the real source implementation
const testCases = [
    // Contains matching
    { content: 'hello world', trigger: 'hello', type: 'contains', expected: true },
    { content: 'say hello please', trigger: 'hello', type: 'contains', expected: true },
    { content: 'hi there', trigger: 'hello', type: 'contains', expected: false },

    // Exact matching
    { content: 'hello', trigger: 'hello', type: 'exact', expected: true },
    { content: 'Hello', trigger: 'hello', type: 'exact', expected: true }, // case insensitive
    { content: 'hello world', trigger: 'hello', type: 'exact', expected: false },

    // Starts with matching
    { content: 'hello world', trigger: 'hello', type: 'startswith', expected: true },
    { content: 'Hello there', trigger: 'hello', type: 'startswith', expected: true },
    { content: 'say hello', trigger: 'hello', type: 'startswith', expected: false },

    // Regex matching (goes through safeRegexTest + isRegexSafe in production)
    { content: 'hello123', trigger: 'hello\\d+', type: 'regex', expected: true },
    { content: 'hello', trigger: 'hello\\d+', type: 'regex', expected: false },
    { content: 'HELLO123', trigger: 'hello\\d+', type: 'regex', expected: true }, // case insensitive
];

describe('Auto-Responder Matching', () => {
    describe('matchesTrigger', () => {
        testCases.forEach(({ content, trigger, type, expected }) => {
            it(`should ${expected ? 'match' : 'not match'} "${content}" with trigger "${trigger}" (${type})`, () => {
                expect(matchesTrigger(content, trigger, type)).toBe(expected);
            });
        });

        describe('Edge cases', () => {
            it('should handle empty content', () => {
                expect(matchesTrigger('', 'hello', 'contains')).toBe(false);
            });

            it('should handle empty trigger with contains', () => {
                expect(matchesTrigger('hello', '', 'contains')).toBe(true);
            });

            it('should handle invalid regex gracefully', () => {
                expect(matchesTrigger('hello', '[invalid(', 'regex')).toBe(false);
            });

            it('should default to contains for unknown type', () => {
                expect(matchesTrigger('hello world', 'hello', 'unknown')).toBe(true);
            });

            it('should be case-insensitive for all non-regex types', () => {
                expect(matchesTrigger('HELLO', 'hello', 'exact')).toBe(true);
                expect(matchesTrigger('HELLO world', 'hello', 'startswith')).toBe(true);
                expect(matchesTrigger('say HELLO', 'hello', 'contains')).toBe(true);
            });

            it('should handle empty trigger with exact match', () => {
                expect(matchesTrigger('', '', 'exact')).toBe(true);
                expect(matchesTrigger('hello', '', 'exact')).toBe(false);
            });

            it('should handle empty trigger with startswith', () => {
                expect(matchesTrigger('hello', '', 'startswith')).toBe(true);
            });
        });
    });

    describe('safeRegexTest', () => {
        it('should match valid safe patterns', () => {
            expect(safeRegexTest('hello world', 'hello')).toBe(true);
            expect(safeRegexTest('test123', '\\d+')).toBe(true);
            expect(safeRegexTest('foobar', '^foo')).toBe(true);
        });

        it('should be case-insensitive', () => {
            expect(safeRegexTest('HELLO', 'hello')).toBe(true);
            expect(safeRegexTest('Hello World', 'hello world')).toBe(true);
        });

        it('should return false for non-matching patterns', () => {
            expect(safeRegexTest('hello', '^world$')).toBe(false);
            expect(safeRegexTest('abc', '\\d+')).toBe(false);
        });

        it('should return false for invalid regex syntax', () => {
            expect(safeRegexTest('hello', '[invalid(')).toBe(false);
        });

        it('should reject patterns flagged as unsafe by isRegexSafe', () => {
            // Multiple consecutive wildcards — caught by isRegexSafe
            expect(safeRegexTest('test', '.*.*.*test')).toBe(false);
        });
    });

    describe('isRegexSafe', () => {
        it('should accept simple safe patterns', () => {
            expect(isRegexSafe('hello')).toBe(true);
            expect(isRegexSafe('^hello$')).toBe(true);
            expect(isRegexSafe('\\d+')).toBe(true);
            expect(isRegexSafe('hello.*world')).toBe(true);
        });

        it('should reject multiple consecutive wildcards', () => {
            expect(isRegexSafe('.*.*.*test')).toBe(false);
        });

        it('should reject multiple consecutive quantifiers', () => {
            expect(isRegexSafe('a++b')).toBe(false);
            expect(isRegexSafe('a**b')).toBe(false);
            expect(isRegexSafe('a??b')).toBe(false);
        });

        it('should reject patterns exceeding max trigger length', () => {
            const longPattern = 'a'.repeat(201);
            expect(isRegexSafe(longPattern)).toBe(false);
        });

        it('should reject patterns with excessive backtracking potential', () => {
            // More than 10 quantifiers
            const manyQuantifiers = 'a+b+c+d+e+f+g+h+i+j+k+';
            expect(isRegexSafe(manyQuantifiers)).toBe(false);
        });

        it('should reject patterns with many groups and quantifiers combined', () => {
            // > 5 groups AND > 5 quantifiers
            const complexPattern = '(a+)(b+)(c+)(d+)(e+)(f+)';
            expect(isRegexSafe(complexPattern)).toBe(false);
        });

        it('should accept patterns at the boundary of safety limits', () => {
            // Exactly 200 characters (max length)
            const maxLengthPattern = 'a'.repeat(200);
            expect(isRegexSafe(maxLengthPattern)).toBe(true);

            // 10 quantifiers (the limit)
            const tenQuantifiers = 'a+b+c+d+e+f+g+h+i+j+';
            expect(isRegexSafe(tenQuantifiers)).toBe(true);
        });
    });
});
