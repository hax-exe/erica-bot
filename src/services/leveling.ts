import { db } from '../db/index.js';
import { guilds, guildMembers, levelRewards } from '../db/schema/index.js';
import { eq, and, sql, lte } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';
import { getLevelingSettings, getDefaultLevelingSettings } from './settingsCache.js';

const logger = createLogger('leveling');

// XP cooldown map: guildId:userId -> last XP gain timestamp
const xpCooldowns = new Map<string, number>();

/**
 * Ensure a guild exists in the database before creating related records.
 * This prevents foreign key constraint violations when the bot joins a guild
 * that wasn't properly initialized or if the database was reset.
 */
export async function ensureGuildExists(guildId: string): Promise<void> {
    await db.insert(guilds).values({
        id: guildId,
    }).onConflictDoNothing();
}

/**
 * Calculate XP required for a level
 * Formula: 5 * (level^2) + 50 * level + 100
 */
export function getXpForLevel(level: number): number {
    return 5 * Math.pow(level, 2) + 50 * level + 100;
}

/**
 * Calculate total XP required to reach a level from 0
 */
export function getTotalXpForLevel(level: number): number {
    let total = 0;
    for (let i = 0; i < level; i++) {
        total += getXpForLevel(i);
    }
    return total;
}

/**
 * Calculate level from total XP
 */
export function getLevelFromXp(xp: number): number {
    let level = 0;
    let requiredXp = getXpForLevel(level);
    let totalXp = 0;

    while (totalXp + requiredXp <= xp) {
        totalXp += requiredXp;
        level++;
        requiredXp = getXpForLevel(level);
    }

    return level;
}

/**
 * Get XP progress within current level
 */
export function getXpProgress(xp: number): { current: number; required: number; percentage: number } {
    const level = getLevelFromXp(xp);
    const totalXpForCurrentLevel = getTotalXpForLevel(level);
    const xpInCurrentLevel = xp - totalXpForCurrentLevel;
    const xpRequiredForNextLevel = getXpForLevel(level);
    const percentage = Math.floor((xpInCurrentLevel / xpRequiredForNextLevel) * 100);

    return {
        current: xpInCurrentLevel,
        required: xpRequiredForNextLevel,
        percentage,
    };
}

interface XpGainResult {
    xpGained: number;
    newXp: number;
    newLevel: number;
    leveledUp: boolean;
    previousLevel: number;
}

/**
 * Add XP to a user and check for level ups
 */
export async function addXp(
    guildId: string,
    userId: string,
    baseXp: number = 15
): Promise<XpGainResult | null> {
    // Check cooldown from in-memory cache (fast path)
    const cooldownKey = `${guildId}:${userId}`;
    const now = Date.now();
    const lastGain = xpCooldowns.get(cooldownKey);

    // Get guild settings from cache (much faster than DB query)
    const settings = await getLevelingSettings(guildId);
    const defaults = getDefaultLevelingSettings();

    const cooldownMs = (settings?.xpCooldown ?? defaults.xpCooldown) * 1000;
    const xpPerMessage = settings?.xpPerMessage ?? defaults.xpPerMessage;
    const multiplier = (settings?.xpMultiplier ?? defaults.xpMultiplier) / 100;

    if (lastGain && now - lastGain < cooldownMs) {
        return null; // Still on cooldown
    }

    // Set new cooldown
    xpCooldowns.set(cooldownKey, now);

    // Calculate XP with multiplier
    const xpGained = Math.floor(xpPerMessage * multiplier);

    // Get or create member record
    const member = await db.query.guildMembers.findFirst({
        where: and(
            eq(guildMembers.guildId, guildId),
            eq(guildMembers.odId, userId)
        ),
    });

    const previousXp = member?.xp ?? 0;
    const previousLevel = member?.level ?? 0;
    const newXp = previousXp + xpGained;
    const newLevel = getLevelFromXp(newXp);
    const leveledUp = newLevel > previousLevel;

    if (!member) {
        // Ensure guild exists before creating member record
        await ensureGuildExists(guildId);
        // Create new member record
        await db.insert(guildMembers).values({
            guildId,
            odId: userId,
            xp: newXp,
            level: newLevel,
            totalMessages: 1,
            lastXpGain: new Date(),
        });
    } else {
        // Update existing record
        await db.update(guildMembers)
            .set({
                xp: newXp,
                level: newLevel,
                totalMessages: sql`${guildMembers.totalMessages} + 1`,
                lastXpGain: new Date(),
                updatedAt: new Date(),
            })
            .where(and(
                eq(guildMembers.guildId, guildId),
                eq(guildMembers.odId, userId)
            ));
    }

    return {
        xpGained,
        newXp,
        newLevel,
        leveledUp,
        previousLevel,
    };
}

/**
 * Get role rewards that should be applied for a level
 */
export async function getRoleRewardsForLevel(
    guildId: string,
    level: number
): Promise<string[]> {
    const rewards = await db.query.levelRewards.findMany({
        where: and(
            eq(levelRewards.guildId, guildId),
            lte(levelRewards.level, level)
        ),
    });

    return rewards.map((r) => r.roleId);
}

/**
 * Check if a channel should be ignored for XP (uses cached settings)
 */
export async function isChannelIgnored(
    guildId: string,
    channelId: string
): Promise<boolean> {
    const settings = await getLevelingSettings(guildId);
    return settings?.ignoredChannels?.includes(channelId) ?? false;
}

/**
 * Check if a role should be ignored for XP (uses cached settings)
 */
export async function hasIgnoredRole(
    guildId: string,
    roleIds: string[]
): Promise<boolean> {
    const settings = await getLevelingSettings(guildId);
    const ignoredRoles = settings?.ignoredRoles ?? [];
    return roleIds.some((id) => ignoredRoles.includes(id));
}
