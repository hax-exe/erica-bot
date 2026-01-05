// TTL-based in-memory cache for hot data (guild settings etc)
export class SimpleCache<T> {
    private cache = new Map<string, { value: T; expiresAt: number }>();
    private cleanupInterval: NodeJS.Timeout | null = null;

    constructor(cleanupIntervalMs: number = 60000) {
        // Periodically clean up expired entries
        this.cleanupInterval = setInterval(() => {
            this.cleanup();
        }, cleanupIntervalMs);
    }

    get(key: string): T | undefined {
        const entry = this.cache.get(key);
        if (!entry) return undefined;

        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return undefined;
        }

        return entry.value;
    }

    set(key: string, value: T, ttlMs: number): void {
        this.cache.set(key, {
            value,
            expiresAt: Date.now() + ttlMs,
        });
    }

    delete(key: string): boolean {
        return this.cache.delete(key);
    }

    has(key: string): boolean {
        const entry = this.cache.get(key);
        if (!entry) return false;

        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return false;
        }

        return true;
    }

    clear(): void {
        this.cache.clear();
    }

    get size(): number {
        return this.cache.size;
    }

    private cleanup(): void {
        const now = Date.now();
        for (const [key, entry] of this.cache) {
            if (now > entry.expiresAt) {
                this.cache.delete(key);
            }
        }
    }

    // call on shutdown
    destroy(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        this.cache.clear();
    }
}

// wraps an async fn with memoization
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
