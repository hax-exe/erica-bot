import { EventEmitter } from 'events';
import { getRedisClient, getRedisSubscriber, REDIS_KEYS, disconnectRedis } from './redis.js';
import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('leader-election');

export interface LeaderElectionEvents {
    becameLeader: () => void;
    lostLeadership: () => void;
    leaderChanged: (newLeaderId: string) => void;
}

export class LeaderElectionService extends EventEmitter {
    private instanceId: string;
    private heartbeatInterval: number;
    private leaderTimeout: number;
    private _isLeader: boolean = false;
    private heartbeatTimer: NodeJS.Timeout | null = null;
    private watcherTimer: NodeJS.Timeout | null = null;
    private isRunning: boolean = false;

    constructor() {
        super();
        this.instanceId = config.ha.instanceId;
        this.heartbeatInterval = config.ha.heartbeatInterval;
        this.leaderTimeout = config.ha.leaderTimeout;
    }

    /**
     * Start the leader election service.
     * Attempts to become leader, or enters standby mode if another leader exists.
     */
    async start(): Promise<void> {
        if (this.isRunning) {
            logger.warn('Leader election service already running');
            return;
        }

        this.isRunning = true;
        logger.info({ instanceId: this.instanceId }, 'Starting leader election service');

        const redis = getRedisClient();
        const subscriber = getRedisSubscriber();

        // Subscribe to leader change notifications
        await subscriber.subscribe(REDIS_KEYS.LEADER_CHANNEL);
        subscriber.on('message', (channel: string, message: string) => {
            if (channel === REDIS_KEYS.LEADER_CHANNEL) {
                this.handleLeaderChange(message);
            }
        });

        // Try to acquire leadership
        const acquired = await this.tryAcquireLeadership();

        if (acquired) {
            await this.becomeLeader();
        } else {
            logger.info({ instanceId: this.instanceId }, 'Another leader exists, entering standby mode');
            this.startWatchingLeader();
        }
    }

    /**
     * Stop the leader election service gracefully.
     */
    async stop(): Promise<void> {
        if (!this.isRunning) return;

        logger.info({ instanceId: this.instanceId }, 'Stopping leader election service');
        this.isRunning = false;

        // Stop timers
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        if (this.watcherTimer) {
            clearInterval(this.watcherTimer);
            this.watcherTimer = null;
        }

        // Release leadership if we're the leader
        if (this._isLeader) {
            await this.releaseLeadership();
        }

        // Clean up our instance key
        const redis = getRedisClient();
        await redis.del(REDIS_KEYS.HEARTBEAT(this.instanceId));

        await disconnectRedis();
    }

    /**
     * Check if this instance is currently the leader.
     */
    get isLeader(): boolean {
        return this._isLeader;
    }

    /**
     * Get the current instance ID.
     */
    get id(): string {
        return this.instanceId;
    }

    /**
     * Get the current leader's instance ID.
     */
    async getLeaderId(): Promise<string | null> {
        const redis = getRedisClient();
        return redis.get(REDIS_KEYS.LEADER);
    }

    /**
     * Try to acquire leadership using Redis SETNX.
     */
    private async tryAcquireLeadership(): Promise<boolean> {
        const redis = getRedisClient();

        // Use SET with NX (only if not exists) and PX (expire in ms)
        const result = await redis.set(
            REDIS_KEYS.LEADER,
            this.instanceId,
            'PX',
            this.leaderTimeout,
            'NX'
        );

        return result === 'OK';
    }

    /**
     * Called when this instance becomes the leader.
     */
    private async becomeLeader(): Promise<void> {
        this._isLeader = true;
        logger.info({ instanceId: this.instanceId }, '🎉 This instance is now the LEADER');

        // Start sending heartbeats
        this.startHeartbeat();

        // Notify other instances
        const redis = getRedisClient();
        await redis.publish(REDIS_KEYS.LEADER_CHANNEL, this.instanceId);

        this.emit('becameLeader');
    }

    /**
     * Release leadership gracefully.
     */
    private async releaseLeadership(): Promise<void> {
        const redis = getRedisClient();

        // Only delete if we're still the leader (compare-and-delete)
        const currentLeader = await redis.get(REDIS_KEYS.LEADER);
        if (currentLeader === this.instanceId) {
            await redis.del(REDIS_KEYS.LEADER);
            logger.info({ instanceId: this.instanceId }, 'Released leadership');

            // Notify others that leadership is available
            await redis.publish(REDIS_KEYS.LEADER_CHANNEL, '');
        }

        this._isLeader = false;
        this.emit('lostLeadership');
    }

    /**
     * Start sending periodic heartbeats.
     */
    private startHeartbeat(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
        }

        const sendHeartbeat = async () => {
            if (!this._isLeader || !this.isRunning) return;

            const redis = getRedisClient();
            try {
                // Refresh our leader key TTL
                await redis.pexpire(REDIS_KEYS.LEADER, this.leaderTimeout);

                // Update instance heartbeat
                await redis.set(
                    REDIS_KEYS.HEARTBEAT(this.instanceId),
                    Date.now().toString(),
                    'PX',
                    this.leaderTimeout
                );

                logger.debug({ instanceId: this.instanceId }, 'Heartbeat sent');
            } catch (error) {
                logger.error({ error }, 'Failed to send heartbeat');
                // If we can't send heartbeat, we may have lost leadership
                this._isLeader = false;
                this.emit('lostLeadership');
            }
        };

        // Send first heartbeat immediately
        sendHeartbeat();

        // Schedule recurring heartbeats
        this.heartbeatTimer = setInterval(sendHeartbeat, this.heartbeatInterval);
    }

    /**
     * Start watching for leader failures (standby mode).
     */
    private startWatchingLeader(): void {
        if (this.watcherTimer) {
            clearInterval(this.watcherTimer);
        }

        const checkLeader = async () => {
            if (this._isLeader || !this.isRunning) return;

            const redis = getRedisClient();
            const currentLeader = await redis.get(REDIS_KEYS.LEADER);

            if (!currentLeader) {
                // No leader! Try to claim leadership
                logger.info({ instanceId: this.instanceId }, 'No leader detected, attempting to claim leadership');
                const acquired = await this.tryAcquireLeadership();

                if (acquired) {
                    if (this.watcherTimer) {
                        clearInterval(this.watcherTimer);
                        this.watcherTimer = null;
                    }
                    await this.becomeLeader();
                }
            }
        };

        // Check every heartbeat interval
        this.watcherTimer = setInterval(checkLeader, this.heartbeatInterval);
    }

    /**
     * Handle leader change notifications.
     */
    private handleLeaderChange(newLeaderId: string): void {
        if (newLeaderId === this.instanceId) {
            // We're the new leader (already handled in becomeLeader)
            return;
        }

        if (newLeaderId === '' && !this._isLeader) {
            // Leadership is available, try to claim it
            logger.info({ instanceId: this.instanceId }, 'Leadership released, attempting to claim');
            this.tryAcquireLeadership().then(acquired => {
                if (acquired) {
                    if (this.watcherTimer) {
                        clearInterval(this.watcherTimer);
                        this.watcherTimer = null;
                    }
                    this.becomeLeader();
                }
            });
        }

        if (newLeaderId && newLeaderId !== this.instanceId) {
            this.emit('leaderChanged', newLeaderId);
        }
    }
}

// Singleton instance
let leaderElectionInstance: LeaderElectionService | null = null;

/**
 * Get or create the leader election service singleton.
 */
export function getLeaderElection(): LeaderElectionService {
    if (!leaderElectionInstance) {
        leaderElectionInstance = new LeaderElectionService();
    }
    return leaderElectionInstance;
}
