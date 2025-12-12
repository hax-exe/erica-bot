import Redis from 'ioredis';
import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('redis');

let redisClient: Redis.Redis | null = null;
let subscriberClient: Redis.Redis | null = null;

/**
 * Get or create the main Redis client for commands.
 */
export function getRedisClient(): Redis.Redis {
    if (!redisClient) {
        redisClient = new Redis.default(config.redis.url, {
            maxRetriesPerRequest: 3,
            retryStrategy(times: number) {
                const delay = Math.min(times * 200, 2000);
                logger.warn({ times, delay }, 'Redis connection retry');
                return delay;
            },
            reconnectOnError(err: Error) {
                const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT'];
                return targetErrors.some(e => err.message.includes(e));
            },
        });

        redisClient.on('connect', () => {
            logger.info('Redis client connected');
        });

        redisClient.on('error', (err: Error) => {
            logger.error({ err }, 'Redis client error');
        });

        redisClient.on('close', () => {
            logger.warn('Redis client connection closed');
        });
    }

    return redisClient;
}

/**
 * Get or create a subscriber client for Pub/Sub.
 * This must be a separate connection from the command client.
 */
export function getRedisSubscriber(): Redis.Redis {
    if (!subscriberClient) {
        subscriberClient = new Redis.default(config.redis.url, {
            maxRetriesPerRequest: null, // Infinite for subscriber
            retryStrategy(times: number) {
                const delay = Math.min(times * 200, 2000);
                return delay;
            },
        });

        subscriberClient.on('connect', () => {
            logger.debug('Redis subscriber connected');
        });

        subscriberClient.on('error', (err: Error) => {
            logger.error({ err }, 'Redis subscriber error');
        });
    }

    return subscriberClient;
}

/**
 * Disconnect all Redis clients gracefully.
 */
export async function disconnectRedis(): Promise<void> {
    const disconnects: Promise<void>[] = [];

    if (redisClient) {
        disconnects.push(
            redisClient.quit().then(() => {
                logger.info('Redis client disconnected');
                redisClient = null;
            })
        );
    }

    if (subscriberClient) {
        disconnects.push(
            subscriberClient.quit().then(() => {
                logger.debug('Redis subscriber disconnected');
                subscriberClient = null;
            })
        );
    }

    await Promise.all(disconnects);
}

// Redis key prefixes for HA
export const REDIS_KEYS = {
    LEADER: 'ha:leader',
    HEARTBEAT: (instanceId: string) => `ha:heartbeat:${instanceId}`,
    PLAYER_STATE: (guildId: string) => `player:${guildId}`,
    LEADER_CHANNEL: 'ha:leader-changes',
} as const;
