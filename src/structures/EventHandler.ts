import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from '../utils/logger.js';
import type { ExtendedClient } from './Client.js';
import type { Event } from '../types/Event.js';
import type { ClientEvents } from 'discord.js';

const logger = createLogger('event-handler');
const __dirname = dirname(fileURLToPath(import.meta.url));

export async function loadEvents(client: ExtendedClient): Promise<void> {
    const eventsPath = join(__dirname, '..', 'events');
    const eventFiles = readdirSync(eventsPath).filter(
        (file) => (file.endsWith('.js') || file.endsWith('.ts')) && !file.endsWith('.d.ts')
    );

    let loadedCount = 0;

    for (const file of eventFiles) {
        const filePath = join(eventsPath, file);

        try {
            const { default: event } = await import(`file://${filePath}`) as {
                default: Event<keyof ClientEvents>
            };

            if (!event?.name) {
                logger.warn(`Event at ${filePath} is missing required properties`);
                continue;
            }

            if (event.once) {
                client.once(event.name, (...args) => event.execute(client, ...args));
            } else {
                client.on(event.name, (...args) => event.execute(client, ...args));
            }

            loadedCount++;
            logger.debug(`Loaded event: ${event.name}`);
        } catch (error) {
            logger.error({ error, file: filePath }, 'Failed to load event');
        }
    }

    logger.info(`Loaded ${loadedCount} events`);
}
