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
    const leader = config.ha.enabled ? getLeaderElection() : null;

    const shutdown = async (signal: string) => {
        logger.info(`Received ${signal}, shutting down gracefully...`);

        stopAllAutoSaves();

        for (const player of client.music.players.values()) {
            player.destroy();
        }

        if (leader) {
            await leader.stop();
        } else {
            await disconnectRedis();
        }

        client.destroy();
        await disconnectDatabase();

        logger.info('Shutdown complete');
        process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    process.on('uncaughtException', (error) => {
        logger.fatal({ error }, 'Uncaught exception');
        process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
        if (reason instanceof Error) {
            logger.error({ err: reason }, 'Unhandled rejection');
        } else {
            logger.error({ reason }, 'Unhandled rejection');
        }
    });

    try {
        logger.info('Starting Erica Bot...');

        if (config.ha.enabled) {
            logger.info({
                instanceId: config.ha.instanceId,
                heartbeatInterval: config.ha.heartbeatInterval,
                leaderTimeout: config.ha.leaderTimeout
            }, '🔄 High Availability mode enabled');

            await loadEvents(client);

            leader!.on('becameLeader', async () => {
                logger.info('🎉 Became leader, starting Discord connection...');
                await client.start();

                setTimeout(async () => {
                    const restored = await restorePlayerStates(client);
                    if (restored > 0) {
                        logger.info({ count: restored }, 'Restored player states from previous leader');
                    }
                }, 5000);
            });

            leader!.on('lostLeadership', () => {
                logger.warn('❌ Lost leadership, disconnecting from Discord...');
                stopAllAutoSaves();
                client.destroy();
            });

            startApiServer(client, leader!);
            await leader!.start();

            if (!leader!.isLeader) {
                logger.info('📋 Running in standby mode, waiting for leadership...');
            }
        } else {
            logger.info('Running in single-instance mode (HA disabled)');
            await loadEvents(client);
            await client.start();
            startApiServer(client);
        }
    } catch (error) {
        logger.fatal({ error }, 'Failed to start bot');
        process.exit(1);
    }
}

main();
