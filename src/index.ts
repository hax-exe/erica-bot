import { ExtendedClient, loadEvents } from './structures/index.js';
import { disconnectDatabase } from './db/index.js';
import { createLogger } from './utils/logger.js';
import { startApiServer } from './api/index.js';
import { disconnectRedis } from './services/redis.js';
import { saveMusicState, saveGameState, notifyShutdown, stopStateCheckpoint } from './services/stateManager.js';

const logger = createLogger('main');

async function main(): Promise<void> {
    const client = new ExtendedClient();
    let isShuttingDown = false;

    const shutdown = async (signal: string) => {
        // Prevent double-shutdown
        if (isShuttingDown) return;
        isShuttingDown = true;

        logger.info(`Received ${signal}, shutting down gracefully...`);

        try {
            // Stop periodic checkpointing
            stopStateCheckpoint();

            // Notify users in active music channels
            await notifyShutdown(client);

            // Save state to Redis before destroying
            logger.info('Saving music state...');
            await saveMusicState(client.music.players);
            logger.info('Saving game state...');
            await saveGameState();

            // Grace period for in-flight commands
            await new Promise(r => setTimeout(r, 2000));

            for (const player of client.music.players.values()) {
                player.destroy();
            }

            await disconnectRedis();
            client.destroy();
            await disconnectDatabase();

            logger.info('Shutdown complete');
        } catch (error) {
            logger.error({ error }, 'Error during shutdown');
        }

        process.exit(0);
    };

    // Handle both SIGINT (Ctrl+C) and SIGTERM
    process.on('SIGINT', () => { shutdown('SIGINT'); });
    process.on('SIGTERM', () => { shutdown('SIGTERM'); });

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
        await loadEvents(client);
        await client.start();
        startApiServer(client);
    } catch (error) {
        logger.fatal({ error }, 'Failed to start bot');
        process.exit(1);
    }
}

main();
