import { Events } from 'discord.js';
import { Event } from '../types/Event.js';
import { createLogger } from '../utils/logger.js';
import { db } from '../db/index.js';
import { guilds, moderationSettings, levelingSettings, economySettings, musicSettings } from '../db/schema/index.js';

const logger = createLogger('guild-create');

export default new Event({
    name: Events.GuildCreate,
    async execute(client, guild) {
        logger.info({ guildId: guild.id, guildName: guild.name }, 'Joined new guild');

        try {
            // Create guild record with default settings
            await db.insert(guilds).values({
                id: guild.id,
            }).onConflictDoNothing();

            // Initialize module settings
            await db.insert(moderationSettings).values({
                guildId: guild.id,
            }).onConflictDoNothing();

            await db.insert(levelingSettings).values({
                guildId: guild.id,
            }).onConflictDoNothing();

            await db.insert(economySettings).values({
                guildId: guild.id,
            }).onConflictDoNothing();

            await db.insert(musicSettings).values({
                guildId: guild.id,
            }).onConflictDoNothing();

            logger.info({ guildId: guild.id }, 'Initialized guild settings');
        } catch (error) {
            logger.error({ error, guildId: guild.id }, 'Failed to initialize guild settings');
        }
    },
});
