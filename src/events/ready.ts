import { Event } from '../types/Event.js';
import { createLogger } from '../utils/logger.js';
import { connectDatabase } from '../db/index.js';
import { pushSchema } from '../db/migrate.js';
import { loadCommands } from '../structures/CommandHandler.js';
import { loadEvents } from '../structures/EventHandler.js';

const logger = createLogger('ready');

export default new Event({
    name: 'ready',
    once: true,
    async execute(client) {
        logger.info(`✅ Logged in as ${client.user?.tag}`);
        logger.info(`📊 Serving ${client.guilds.cache.size} guilds`);

        // Connect to database
        await connectDatabase();

        // Push schema (creates tables if they don't exist)
        await pushSchema();

        // Load commands after ready
        await loadCommands(client);

        // Deploy slash commands
        await client.deployCommands();

        // Set bot presence
        client.user?.setPresence({
            status: 'online',
            activities: [
                {
                    name: '/help | Multi-Bot',
                    type: 3, // Watching
                },
            ],
        });

        logger.info('🚀 Bot is fully ready!');
    },
});
