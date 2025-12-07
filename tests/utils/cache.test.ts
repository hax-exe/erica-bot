import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SimpleCache, memoize } from '../../src/utils/cache.js';

describe('SimpleCache', () => {
    let cache: SimpleCache<string>;

    beforeEach(() => {
        vi.useFakeTimers();
        cache = new SimpleCache<string>(60000); // 1 minute cleanup interval
    });

    afterEach(() => {
        cache.destroy();
        vi.useRealTimers();
    });

    describe('get and set', () => {
        it('should store and retrieve values', () => {
            cache.set('key1', 'value1', 5000);
            expect(cache.get('key1')).toBe('value1');
        });

        it('should return undefined for non-existent keys', () => {
            expect(cache.get('nonexistent')).toBeUndefined();
        });

        it('should return undefined for expired keys', () => {
            cache.set('key1', 'value1', 1000);

            // Advance time past TTL
            vi.advanceTimersByTime(1001);

            expect(cache.get('key1')).toBeUndefined();
        });

        it('should return value before TTL expires', () => {
            cache.set('key1', 'value1', 5000);

            // Advance time but not past TTL
            vi.advanceTimersByTime(4000);

            expect(cache.get('key1')).toBe('value1');
        });
    });

    describe('has', () => {
        it('should return true for existing non-expired keys', () => {
            cache.set('key1', 'value1', 5000);
            expect(cache.has('key1')).toBe(true);
        });

        it('should return false for non-existent keys', () => {
            expect(cache.has('nonexistent')).toBe(false);
        });

        it('should return false for expired keys', () => {
            cache.set('key1', 'value1', 1000);
            vi.advanceTimersByTime(1001);
            expect(cache.has('key1')).toBe(false);
        });
    });

    describe('delete', () => {
        it('should remove a key from cache', () => {
            cache.set('key1', 'value1', 5000);
            expect(cache.delete('key1')).toBe(true);
            expect(cache.get('key1')).toBeUndefined();
        });

        it('should return false when deleting non-existent key', () => {
            expect(cache.delete('nonexistent')).toBe(false);
        });
    });

    describe('clear', () => {
        it('should remove all entries', () => {
            cache.set('key1', 'value1', 5000);
            cache.set('key2', 'value2', 5000);
            cache.set('key3', 'value3', 5000);

            cache.clear();

            expect(cache.size).toBe(0);
            expect(cache.get('key1')).toBeUndefined();
            expect(cache.get('key2')).toBeUndefined();
            expect(cache.get('key3')).toBeUndefined();
        });
    });

    describe('size', () => {
        it('should return the number of entries', () => {
            expect(cache.size).toBe(0);

            cache.set('key1', 'value1', 5000);
            expect(cache.size).toBe(1);

            cache.set('key2', 'value2', 5000);
            expect(cache.size).toBe(2);
        });
    });

    describe('cleanup interval', () => {
        it('should automatically clean up expired entries', () => {
            cache.set('shortLived', 'value1', 1000);
            cache.set('longLived', 'value2', 120000);

            // Advance past short TTL but not long TTL
            vi.advanceTimersByTime(2000);

            // Trigger cleanup interval
            vi.advanceTimersByTime(60000);

            // Short-lived should be cleaned up, long-lived should remain
            expect(cache.get('shortLived')).toBeUndefined();
            expect(cache.get('longLived')).toBe('value2');
        });
    });
});

describe('memoize', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should cache function results', async () => {
        const mockFn = vi.fn().mockResolvedValue('result');
        const memoized = memoize(mockFn, (arg) => arg, 5000);

        // First call - should execute function
        const result1 = await memoized('key1');
        expect(result1).toBe('result');
        expect(mockFn).toHaveBeenCalledTimes(1);

        // Second call with same key - should return cached result
        const result2 = await memoized('key1');
        expect(result2).toBe('result');
        expect(mockFn).toHaveBeenCalledTimes(1); // Still 1 - cached

        // Call with different key - should execute function
        const result3 = await memoized('key2');
        expect(result3).toBe('result');
        expect(mockFn).toHaveBeenCalledTimes(2);
    });

    it('should re-execute after TTL expires', async () => {
        const mockFn = vi.fn().mockResolvedValue('result');
        const memoized = memoize(mockFn, (arg) => arg, 1000);

        await memoized('key1');
        expect(mockFn).toHaveBeenCalledTimes(1);

        // Advance past TTL
        vi.advanceTimersByTime(1001);

        await memoized('key1');
        expect(mockFn).toHaveBeenCalledTimes(2); // Re-executed
    });
});
