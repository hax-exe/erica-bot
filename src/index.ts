import { ExtendedClient, loadEvents } from './structures/index.js';
import { disconnectDatabase } from './db/index.js';
import { createLogger } from './utils/logger.js';
import { startApiServer } from './api/index.js';
import { disconnectRedis } from './services/redis.js';

const logger = createLogger('main');

async function main(): Promise<void> {
    const client = new ExtendedClient();

    const shutdown = async (signal: string) => {
        logger.info(`Received ${signal}, shutting down gracefully...`);

        for (const player of client.music.players.values()) {
            player.destroy();
        }

        await disconnectRedis();
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
        await loadEvents(client);
        await client.start();
        startApiServer(client);
    } catch (error) {
        logger.fatal({ error }, 'Failed to start bot');
        process.exit(1);
    }
}

main();
