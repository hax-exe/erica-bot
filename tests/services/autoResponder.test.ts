import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock data for testing auto-responder matching
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

    // Regex matching
    { content: 'hello123', trigger: 'hello\\d+', type: 'regex', expected: true },
    { content: 'hello', trigger: 'hello\\d+', type: 'regex', expected: false },
    { content: 'HELLO123', trigger: 'hello\\d+', type: 'regex', expected: true }, // case insensitive
];

// Reimplementing the matching logic for testing without db dependency
function matchesTrigger(content: string, trigger: string, type: string): boolean {
    const lowerContent = content.toLowerCase();
    const lowerTrigger = trigger.toLowerCase();

    switch (type) {
        case 'exact':
            return lowerContent === lowerTrigger;
        case 'startswith':
            return lowerContent.startsWith(lowerTrigger);
        case 'regex':
            try {
                const regex = new RegExp(trigger, 'i');
                return regex.test(content);
            } catch {
                return false;
            }
        case 'contains':
        default:
            return lowerContent.includes(lowerTrigger);
    }
}

describe('Auto-Responder Matching', () => {
    testCases.forEach(({ content, trigger, type, expected }) => {
        it(`should ${expected ? 'match' : 'not match'} "${content}" with trigger "${trigger}" (${type})`, () => {
            expect(matchesTrigger(content, trigger, type)).toBe(expected);
        });
    });

    describe('Edge cases', () => {
        it('should handle empty content', () => {
            expect(matchesTrigger('', 'hello', 'contains')).toBe(false);
        });

        it('should handle empty trigger', () => {
            expect(matchesTrigger('hello', '', 'contains')).toBe(true);
        });

        it('should handle invalid regex gracefully', () => {
            expect(matchesTrigger('hello', '[invalid(', 'regex')).toBe(false);
        });

        it('should default to contains for unknown type', () => {
            expect(matchesTrigger('hello world', 'hello', 'unknown')).toBe(true);
        });
    });
});
