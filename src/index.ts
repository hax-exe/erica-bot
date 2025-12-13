import { ExtendedClient, loadEvents } from './structures/index.js';
import { disconnectDatabase } from './db/index.js';
import { createLogger } from './utils/logger.js';
import { startApiServer } from './api/index.js';
import { config } from './config/index.js';
import { getLeaderElection } from './services/leaderElection.js';
import { restorePlayerStates, stopAllAutoSaves } from './services/playerState.js';
import { disconnectRedis } from './services/redis.js';

const logger = createLogger('main');

async function main(): Promise<void> {
    const client = new ExtendedClient();
    const leaderElection = config.ha.enabled ? getLeaderElection() : null;

    // Graceful shutdown
    const shutdown = async (signal: string) => {
        logger.info(`Received ${signal}, shutting down gracefully...`);

        // Stop auto-saving player states
        stopAllAutoSaves();

        // Destroy all music players
        for (const player of client.music.players.values()) {
            player.destroy();
        }

        // Stop leader election if enabled
        if (leaderElection) {
            await leaderElection.stop();
        } else {
            // Only disconnect Redis if we're managing it directly
            await disconnectRedis();
        }

        // Disconnect from Discord
        client.destroy();

        // Close database connection
        await disconnectDatabase();

        logger.info('Shutdown complete');
        process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
        logger.fatal({ error }, 'Uncaught exception');
        process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
        // Pino serializes Error objects properly when using 'err' key
        if (reason instanceof Error) {
            logger.error({ err: reason }, 'Unhandled rejection');
        } else {
            logger.error({ reason }, 'Unhandled rejection');
        }
    });

    // Start the bot
    try {
        logger.info('Starting Multi-Bot Discord...');

        if (config.ha.enabled) {
            logger.info({
                instanceId: config.ha.instanceId,
                heartbeatInterval: config.ha.heartbeatInterval,
                leaderTimeout: config.ha.leaderTimeout
            }, '🔄 High Availability mode enabled');

            // Load events first (ready event will load commands)
            await loadEvents(client);

            // Setup leader election event handlers
            leaderElection!.on('becameLeader', async () => {
                logger.info('🎉 Became leader, starting Discord connection...');

                // Start the Discord client
                await client.start();

                // Attempt to restore player states from previous leader
                setTimeout(async () => {
                    const restored = await restorePlayerStates(client);
                    if (restored > 0) {
                        logger.info({ count: restored }, 'Restored player states from previous leader');
                    }
                }, 5000); // Wait for guilds to be cached
            });

            leaderElection!.on('lostLeadership', () => {
                logger.warn('❌ Lost leadership, disconnecting from Discord...');

                // Save all player states before disconnecting
                stopAllAutoSaves();

                // Disconnect from Discord (standby will take over)
                client.destroy();
            });

            // Start the API server (always running for health checks)
            startApiServer(client, leaderElection!);

            // Start leader election
            await leaderElection!.start();

            // If we're not the leader, we'll wait for becameLeader event
            if (!leaderElection!.isLeader) {
                logger.info('📋 Running in standby mode, waiting for leadership...');
            }
        } else {
            // Non-HA mode: start normally
            logger.info('Running in single-instance mode (HA disabled)');

            // Load events first
            await loadEvents(client);

            // Start the Discord client
            await client.start();

            // Start the API server
            startApiServer(client);
        }
    } catch (error) {
        logger.fatal({ error }, 'Failed to start bot');
        process.exit(1);
    }
}

main();
