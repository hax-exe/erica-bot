/**
 * Simple in-memory cache with TTL (time-to-live) support.
 * Used for caching frequently accessed data like guild settings.
 */
export class SimpleCache<T> {
    private cache = new Map<string, { value: T; expiresAt: number }>();
    private cleanupInterval: NodeJS.Timeout | null = null;

    constructor(cleanupIntervalMs: number = 60000) {
        // Periodically clean up expired entries
        this.cleanupInterval = setInterval(() => {
            this.cleanup();
        }, cleanupIntervalMs);
    }

    /**
     * Get a value from the cache.
     * Returns undefined if not found or expired.
     */
    get(key: string): T | undefined {
        const entry = this.cache.get(key);
        if (!entry) return undefined;

        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return undefined;
        }

        return entry.value;
    }

    /**
     * Set a value in the cache with a TTL.
     */
    set(key: string, value: T, ttlMs: number): void {
        this.cache.set(key, {
            value,
            expiresAt: Date.now() + ttlMs,
        });
    }

    /**
     * Delete a specific key from the cache.
     */
    delete(key: string): boolean {
        return this.cache.delete(key);
    }

    /**
     * Check if a key exists and is not expired.
     */
    has(key: string): boolean {
        const entry = this.cache.get(key);
        if (!entry) return false;

        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return false;
        }

        return true;
    }

    /**
     * Clear all entries from the cache.
     */
    clear(): void {
        this.cache.clear();
    }

    /**
     * Get the number of entries in the cache (including expired).
     */
    get size(): number {
        return this.cache.size;
    }

    /**
     * Clean up expired entries.
     */
    private cleanup(): void {
        const now = Date.now();
        for (const [key, entry] of this.cache) {
            if (now > entry.expiresAt) {
                this.cache.delete(key);
            }
        }
    }

    /**
     * Stop the cleanup interval (call when shutting down).
     */
    destroy(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        this.cache.clear();
    }
}

/**
 * Create a memoized function with cache TTL.
 * Useful for wrapping database query functions.
 */
export function memoize<T, Args extends unknown[]>(
    fn: (...args: Args) => Promise<T>,
    keyFn: (...args: Args) => string,
    ttlMs: number
): (...args: Args) => Promise<T> {
    const cache = new SimpleCache<T>();

    return async (...args: Args): Promise<T> => {
        const key = keyFn(...args);
        const cached = cache.get(key);

        if (cached !== undefined) {
            return cached;
        }

        const result = await fn(...args);
        cache.set(key, result, ttlMs);
        return result;
    };
}
