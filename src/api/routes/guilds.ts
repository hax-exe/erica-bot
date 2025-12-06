import { Router, Request, Response } from 'express';
import { requireManageGuild } from '../middleware/auth.js';
import { db } from '../../db/index.js';
import { guilds, moderationSettings, levelingSettings, economySettings, musicSettings } from '../../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('api:guilds');
const router = Router();

/**
 * GET /api/guilds
 * Get list of all guilds the bot is in (for server selection)
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
    try {
        const client = req.discordClient;

        const guilds = client.guilds.cache.map(guild => ({
            id: guild.id,
            name: guild.name,
            icon: guild.iconURL({ size: 64 }),
            memberCount: guild.memberCount,
        }));

        res.json(guilds);
    } catch (error) {
        logger.error({ error }, 'Failed to get guilds list');
        res.status(500).json({ error: 'Failed to get guilds list' });
    }
});

/**
 * GET /api/guilds/:guildId
 * Get basic guild information
 */
router.get('/:guildId', requireManageGuild, async (req: Request, res: Response): Promise<void> => {
    try {
        const guildId = req.params.guildId!;
        const client = req.discordClient;

        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            res.status(404).json({ error: 'Guild not found' });
            return;
        }

        // Get guild data from database
        const [guildData] = await db.select().from(guilds).where(eq(guilds.id, guildId));

        res.json({
            id: guild.id,
            name: guild.name,
            icon: guild.iconURL({ size: 128 }),
            memberCount: guild.memberCount,
            ownerId: guild.ownerId,
            channels: guild.channels.cache.size,
            roles: guild.roles.cache.size,
            boostLevel: guild.premiumTier,
            boostCount: guild.premiumSubscriptionCount,
            createdAt: guild.createdAt.toISOString(),
            botJoinedAt: guild.joinedAt?.toISOString(),
            settings: guildData || null,
        });
    } catch (error) {
        logger.error({ error }, 'Failed to get guild');
        res.status(500).json({ error: 'Failed to get guild information' });
    }
});

/**
 * GET /api/guilds/:guildId/settings
 * Get all guild settings from database
 */
router.get('/:guildId/settings', requireManageGuild, async (req: Request, res: Response): Promise<void> => {
    try {
        const guildId = req.params.guildId!;

        // Fetch all settings in parallel
        const [guildData, modSettings, levelSettings, ecoSettings, musicSettingsData] = await Promise.all([
            db.select().from(guilds).where(eq(guilds.id, guildId)),
            db.select().from(moderationSettings).where(eq(moderationSettings.guildId, guildId)),
            db.select().from(levelingSettings).where(eq(levelingSettings.guildId, guildId)),
            db.select().from(economySettings).where(eq(economySettings.guildId, guildId)),
            db.select().from(musicSettings).where(eq(musicSettings.guildId, guildId)),
        ]);

        res.json({
            general: guildData[0] || null,
            moderation: modSettings[0] || null,
            leveling: levelSettings[0] || null,
            economy: ecoSettings[0] || null,
            music: musicSettingsData[0] || null,
        });
    } catch (error) {
        logger.error({ error }, 'Failed to get guild settings');
        res.status(500).json({ error: 'Failed to get guild settings' });
    }
});

/**
 * PUT /api/guilds/:guildId/settings
 * Update guild settings
 */
router.put('/:guildId/settings', requireManageGuild, async (req: Request, res: Response): Promise<void> => {
    try {
        const guildId = req.params.guildId!;
        const { general, moderation, leveling, economy, music } = req.body;

        // Ensure guild exists in database
        const [existingGuild] = await db.select().from(guilds).where(eq(guilds.id, guildId));

        if (!existingGuild) {
            // Create guild entry
            await db.insert(guilds).values({ id: guildId });
        }

        // Update each settings table as needed
        const updates: Promise<unknown>[] = [];

        if (general) {
            updates.push(
                db.update(guilds)
                    .set({ ...general, updatedAt: new Date() })
                    .where(eq(guilds.id, guildId))
            );
        }

        if (moderation) {
            const [existing] = await db.select().from(moderationSettings).where(eq(moderationSettings.guildId, guildId));
            if (existing) {
                updates.push(
                    db.update(moderationSettings)
                        .set({ ...moderation, updatedAt: new Date() })
                        .where(eq(moderationSettings.guildId, guildId))
                );
            } else {
                updates.push(
                    db.insert(moderationSettings).values({ guildId, ...moderation })
                );
            }
        }

        if (leveling) {
            const [existing] = await db.select().from(levelingSettings).where(eq(levelingSettings.guildId, guildId));
            if (existing) {
                updates.push(
                    db.update(levelingSettings)
                        .set({ ...leveling, updatedAt: new Date() })
                        .where(eq(levelingSettings.guildId, guildId))
                );
            } else {
                updates.push(
                    db.insert(levelingSettings).values({ guildId, ...leveling })
                );
            }
        }

        if (economy) {
            const [existing] = await db.select().from(economySettings).where(eq(economySettings.guildId, guildId));
            if (existing) {
                updates.push(
                    db.update(economySettings)
                        .set({ ...economy, updatedAt: new Date() })
                        .where(eq(economySettings.guildId, guildId))
                );
            } else {
                updates.push(
                    db.insert(economySettings).values({ guildId, ...economy })
                );
            }
        }

        if (music) {
            const [existing] = await db.select().from(musicSettings).where(eq(musicSettings.guildId, guildId));
            if (existing) {
                updates.push(
                    db.update(musicSettings)
                        .set({ ...music, updatedAt: new Date() })
                        .where(eq(musicSettings.guildId, guildId))
                );
            } else {
                updates.push(
                    db.insert(musicSettings).values({ guildId, ...music })
                );
            }
        }

        await Promise.all(updates);

        logger.info({ guildId, userId: req.userId }, 'Guild settings updated');
        res.json({ success: true, message: 'Settings updated successfully' });
    } catch (error) {
        logger.error({ error }, 'Failed to update guild settings');
        res.status(500).json({ error: 'Failed to update guild settings' });
    }
});

/**
 * GET /api/guilds/:guildId/channels
 * Get guild channels for selection dropdowns
 */
router.get('/:guildId/channels', requireManageGuild, async (req: Request, res: Response): Promise<void> => {
    try {
        const guildId = req.params.guildId!;
        const client = req.discordClient;

        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            res.status(404).json({ error: 'Guild not found' });
            return;
        }

        const channels = guild.channels.cache
            .filter(c => c.isTextBased() && !c.isThread())
            .map(c => ({
                id: c.id,
                name: c.name,
                type: c.type,
                parentId: c.parentId,
            }))
            .sort((a, b) => a.name.localeCompare(b.name));

        res.json(channels);
    } catch (error) {
        logger.error({ error }, 'Failed to get channels');
        res.status(500).json({ error: 'Failed to get channels' });
    }
});

/**
 * GET /api/guilds/:guildId/roles
 * Get guild roles for selection dropdowns
 */
router.get('/:guildId/roles', requireManageGuild, async (req: Request, res: Response): Promise<void> => {
    try {
        const guildId = req.params.guildId!;
        const client = req.discordClient;

        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            res.status(404).json({ error: 'Guild not found' });
            return;
        }

        const roles = guild.roles.cache
            .filter(r => r.id !== guild.id) // Exclude @everyone
            .map(r => ({
                id: r.id,
                name: r.name,
                color: r.hexColor,
                position: r.position,
                managed: r.managed,
            }))
            .sort((a, b) => b.position - a.position);

        res.json(roles);
    } catch (error) {
        logger.error({ error }, 'Failed to get roles');
        res.status(500).json({ error: 'Failed to get roles' });
    }
});

export { router as guildsRouter };
