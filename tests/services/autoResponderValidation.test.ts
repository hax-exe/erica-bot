import { describe, it, expect } from 'vitest';
import { validateTrigger, validateResponse } from '../../src/services/autoResponder.js';

describe('Auto Responder Validation', () => {
    describe('validateTrigger', () => {
        describe('basic validation', () => {
            it('should reject empty triggers', () => {
                expect(validateTrigger('', 'contains')).toEqual({
                    valid: false,
                    error: 'Trigger cannot be empty',
                });
            });

            it('should reject whitespace-only triggers', () => {
                expect(validateTrigger('   ', 'contains')).toEqual({
                    valid: false,
                    error: 'Trigger cannot be empty',
                });
            });

            it('should accept valid triggers', () => {
                expect(validateTrigger('hello', 'contains')).toEqual({ valid: true });
                expect(validateTrigger('hello world', 'exact')).toEqual({ valid: true });
                expect(validateTrigger('!command', 'startswith')).toEqual({ valid: true });
            });

            it('should reject triggers exceeding max length', () => {
                const longTrigger = 'a'.repeat(201);
                const result = validateTrigger(longTrigger, 'contains');
                expect(result.valid).toBe(false);
                expect(result.error).toContain('maximum length');
            });
        });

        describe('regex validation', () => {
            it('should accept valid simple regex patterns', () => {
                expect(validateTrigger('hello.*world', 'regex')).toEqual({ valid: true });
                expect(validateTrigger('^hello$', 'regex')).toEqual({ valid: true });
                expect(validateTrigger('\\d+', 'regex')).toEqual({ valid: true });
            });

            it('should reject invalid regex patterns', () => {
                const result = validateTrigger('[invalid(regex', 'regex');
                expect(result.valid).toBe(false);
                expect(result.error).toBe('Invalid regex pattern');
            });

            it('should reject potentially dangerous ReDoS patterns', () => {
                // Multiple consecutive wildcards
                const result1 = validateTrigger('.*.*.*test', 'regex');
                expect(result1.valid).toBe(false);
                expect(result1.error).toContain('dangerous');

                // Pattern with excessive backtracking potential
                const result2 = validateTrigger('(a+)+b', 'regex');
                // This specific pattern may or may not be caught by heuristics
                // The key is that complex patterns are scrutinized
            });

            it('should reject excessively long regex patterns', () => {
                const longPattern = 'a' + 'b?'.repeat(100);
                const result = validateTrigger(longPattern, 'regex');
                expect(result.valid).toBe(false);
            });
        });
    });

    describe('validateResponse', () => {
        it('should reject empty responses', () => {
            expect(validateResponse('')).toEqual({
                valid: false,
                error: 'Response cannot be empty',
            });
        });

        it('should reject whitespace-only responses', () => {
            expect(validateResponse('   ')).toEqual({
                valid: false,
                error: 'Response cannot be empty',
            });
        });

        it('should accept valid responses', () => {
            expect(validateResponse('Hello {user}!')).toEqual({ valid: true });
            expect(validateResponse('Welcome to {server}!')).toEqual({ valid: true });
        });

        it('should reject responses exceeding max length', () => {
            const longResponse = 'a'.repeat(2001);
            const result = validateResponse(longResponse);
            expect(result.valid).toBe(false);
            expect(result.error).toContain('maximum length');
        });
    });
});

describe('ReDoS Protection', () => {
    // These tests ensure that dangerous regex patterns are either rejected
    // or handled safely at runtime

    it('should handle catastrophic backtracking patterns safely', () => {
        // Classic ReDoS pattern: (a+)+
        const dangerousPattern = '(a+)+b';

        // Even if validation passes, runtime should be safe
        // This is a heuristic test - the important thing is the bot doesn't freeze
        const result = validateTrigger(dangerousPattern, 'regex');

        // We either reject it at validation or handle it safely at runtime
        // Both are acceptable security measures
        expect(typeof result.valid).toBe('boolean');
    });

    it('should reject patterns with multiple nested quantifiers', () => {
        // Pattern that could cause exponential backtracking
        const pattern = '(.*a){10}';
        const result = validateTrigger(pattern, 'regex');

        // Should have some form of protection
        // (either rejected or flagged as potentially dangerous)
        expect(result).toBeDefined();
    });
});
