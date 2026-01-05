import { db } from '../db/index.js';
import { guilds, economySettings, levelingSettings, moderationSettings } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { SimpleCache } from '../utils/cache.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('settings-cache');

// Cache TTL in milliseconds (5 minutes)
const CACHE_TTL = 5 * 60 * 1000;

// Type definitions for cached settings
type GuildSettings = typeof guilds.$inferSelect;
type EconomySettingsType = typeof economySettings.$inferSelect;
type LevelingSettingsType = typeof levelingSettings.$inferSelect;
type ModerationSettingsType = typeof moderationSettings.$inferSelect;

// Caches for different setting types
const guildSettingsCache = new SimpleCache<GuildSettings | null>();
const economySettingsCache = new SimpleCache<EconomySettingsType | null>();
const levelingSettingsCache = new SimpleCache<LevelingSettingsType | null>();
const moderationSettingsCache = new SimpleCache<ModerationSettingsType | null>();

export async function getGuildSettings(guildId: string): Promise<GuildSettings | null> {
    const cached = guildSettingsCache.get(guildId);
    if (cached !== undefined) {
        return cached;
    }

    const settings = await db.query.guilds.findFirst({
        where: eq(guilds.id, guildId),
    }) ?? null;

    guildSettingsCache.set(guildId, settings, CACHE_TTL);
    return settings;
}

export async function getEconomySettings(guildId: string): Promise<EconomySettingsType | null> {
    const cached = economySettingsCache.get(guildId);
    if (cached !== undefined) {
        return cached;
    }

    const settings = await db.query.economySettings.findFirst({
        where: eq(economySettings.guildId, guildId),
    }) ?? null;

    economySettingsCache.set(guildId, settings, CACHE_TTL);
    return settings;
}

export async function getLevelingSettings(guildId: string): Promise<LevelingSettingsType | null> {
    const cached = levelingSettingsCache.get(guildId);
    if (cached !== undefined) {
        return cached;
    }

    const settings = await db.query.levelingSettings.findFirst({
        where: eq(levelingSettings.guildId, guildId),
    }) ?? null;

    levelingSettingsCache.set(guildId, settings, CACHE_TTL);
    return settings;
}

export async function getModerationSettings(guildId: string): Promise<ModerationSettingsType | null> {
    const cached = moderationSettingsCache.get(guildId);
    if (cached !== undefined) {
        return cached;
    }

    const settings = await db.query.moderationSettings.findFirst({
        where: eq(moderationSettings.guildId, guildId),
    }) ?? null;

    moderationSettingsCache.set(guildId, settings, CACHE_TTL);
    return settings;
}

// call when settings are updated
export function invalidateGuildCache(guildId: string): void {
    guildSettingsCache.delete(guildId);
    economySettingsCache.delete(guildId);
    levelingSettingsCache.delete(guildId);
    moderationSettingsCache.delete(guildId);
    logger.debug({ guildId }, 'Invalidated settings cache for guild');
}

export function clearAllCaches(): void {
    guildSettingsCache.clear();
    economySettingsCache.clear();
    levelingSettingsCache.clear();
    moderationSettingsCache.clear();
    logger.debug('Cleared all settings caches');
}

export function getDefaultEconomySettings() {
    return {
        currencyName: 'coins',
        currencySymbol: '🪙',
        dailyAmount: 100,
        workMinAmount: 50,
        workMaxAmount: 200,
        workCooldown: 3600,
    };
}

export function getDefaultLevelingSettings() {
    return {
        xpPerMessage: 15,
        xpCooldown: 60,
        xpMultiplier: 100,
        announceEnabled: true,
        announceMessage: '🎉 Congratulations {user}! You reached level {level}!',
        ignoredChannels: [] as string[],
        ignoredRoles: [] as string[],
    };
}
