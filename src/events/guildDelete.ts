import { Events } from 'discord.js';
import { Event } from '../types/Event.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('guild-delete');

export default new Event({
    name: Events.GuildDelete,
    async execute(_client, guild) {
        logger.info({ guildId: guild.id, guildName: guild.name }, 'Left guild');

        // Note: The database records are automatically cleaned up via CASCADE delete
        // when guild record is deleted. We could optionally implement soft-delete
        // to retain data for a period before permanent deletion.
    },
});
