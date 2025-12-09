import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from '../utils/logger.js';
import type { ExtendedClient } from './Client.js';
import type { Command } from '../types/Command.js';

const logger = createLogger('command-handler');
const __dirname = dirname(fileURLToPath(import.meta.url));

export async function loadCommands(client: ExtendedClient): Promise<void> {
    const commandsPath = join(__dirname, '..', 'commands');
    const categories = readdirSync(commandsPath);

    for (const category of categories) {
        const categoryPath = join(commandsPath, category);
        const commandFiles = readdirSync(categoryPath).filter(
            (file) => (file.endsWith('.js') || file.endsWith('.ts')) && !file.endsWith('.d.ts')
        );

        for (const file of commandFiles) {
            const filePath = join(categoryPath, file);

            try {
                const { default: command } = await import(`file://${filePath}`) as { default: Command };

                if (!command?.data?.name) {
                    logger.warn(`Command at ${filePath} is missing required properties`);
                    continue;
                }

                client.commands.set(command.data.name, command);
                logger.debug(`Loaded command: ${command.data.name} (${category})`);
            } catch (error) {
                logger.error({ error, file: filePath }, 'Failed to load command');
            }
        }
    }

    logger.info(`Loaded ${client.commands.size} commands`);
}
