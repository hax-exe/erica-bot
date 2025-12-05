import { ExtendedClient, loadEvents } from './structures/index.js';
import { disconnectDatabase } from './db/index.js';
import { createLogger } from './utils/logger.js';

const logger = createLogger('main');

async function main(): Promise<void> {
    const client = new ExtendedClient();

    // Load events first (ready event will load commands)
    await loadEvents(client);

    // Graceful shutdown
    const shutdown = async (signal: string) => {
        logger.info(`Received ${signal}, shutting down gracefully...`);

        // Destroy all music players
        for (const player of client.music.players.values()) {
            player.destroy();
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
        logger.error({ reason }, 'Unhandled rejection');
    });

    // Start the bot
    try {
        logger.info('Starting Multi-Bot Discord...');
        await client.start();
    } catch (error) {
        logger.fatal({ error }, 'Failed to start bot');
        process.exit(1);
    }
}

main();
