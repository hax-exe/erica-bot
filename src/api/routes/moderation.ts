import { Router, Request, Response } from 'express';
import { requireManageGuild, requireModeratePermission } from '../middleware/auth.js';
import { db } from '../../db/index.js';
import { warnings, moderationSettings } from '../../db/schema/index.js';
import { eq, and, desc, count } from 'drizzle-orm';
import { createLogger } from '../../utils/logger.js';
import { z } from 'zod';

const logger = createLogger('api:moderation');
const router = Router();

// Validation schemas
const warningSchema = z.object({
    userId: z.string().min(17).max(20),
    reason: z.string().min(1).max(500),
});

/**
 * GET /api/guilds/:guildId/warnings
 * Get all warnings for a guild
 */
router.get('/:guildId/warnings', requireManageGuild, async (req: Request, res: Response): Promise<void> => {
    try {
        const guildId = req.params.guildId!;
        const client = req.discordClient;

        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            res.status(404).json({ error: 'Guild not found' });
            return;
        }

        const allWarnings = await db.select()
            .from(warnings)
            .where(eq(warnings.guildId, guildId))
            .orderBy(desc(warnings.createdAt));

        // Enrich with user data
        const enrichedWarnings = await Promise.all(
            allWarnings.map(async (warning) => {
                let username = 'Unknown User';
                let avatar = null;
                let moderatorName = 'Unknown Moderator';

                try {
                    const user = await client.users.fetch(warning.userId);
                    username = user.username;
                    avatar = user.displayAvatarURL({ size: 64 });
                } catch {
                    // User not found
                }

                try {
                    const moderator = await client.users.fetch(warning.moderatorId);
                    moderatorName = moderator.username;
                } catch {
                    // Moderator not found
                }

                return {
                    ...warning,
                    username,
                    avatar,
                    moderatorName,
                };
            })
        );

        res.json(enrichedWarnings);
    } catch (error) {
        logger.error({ error }, 'Failed to get warnings');
        res.status(500).json({ error: 'Failed to get warnings' });
    }
});

/**
 * GET /api/guilds/:guildId/warnings/:userId
 * Get warnings for a specific user
 */
router.get('/:guildId/warnings/:userId', requireManageGuild, async (req: Request, res: Response): Promise<void> => {
    try {
        const guildId = req.params.guildId!;
        const userId = req.params.userId!;

        const userWarnings = await db.select()
            .from(warnings)
            .where(and(
                eq(warnings.guildId, guildId),
                eq(warnings.userId, userId)
            ))
            .orderBy(desc(warnings.createdAt));

        res.json(userWarnings);
    } catch (error) {
        logger.error({ error }, 'Failed to get user warnings');
        res.status(500).json({ error: 'Failed to get user warnings' });
    }
});

/**
 * POST /api/guilds/:guildId/warnings
 * Add a warning to a user
 */
router.post('/:guildId/warnings', requireModeratePermission, async (req: Request, res: Response): Promise<void> => {
    try {
        const guildId = req.params.guildId!;

        const body = warningSchema.safeParse(req.body);
        if (!body.success) {
            res.status(400).json({ error: 'Invalid request body', details: body.error.issues });
            return;
        }

        const { userId, reason } = body.data;

        // Insert warning
        const [newWarning] = await db.insert(warnings)
            .values({
                guildId,
                userId,
                moderatorId: req.userId!,
                reason,
            })
            .returning();

        logger.info({ guildId, userId, moderatorId: req.userId, reason }, 'Warning added via dashboard');
        res.status(201).json(newWarning);
    } catch (error) {
        logger.error({ error }, 'Failed to add warning');
        res.status(500).json({ error: 'Failed to add warning' });
    }
});

/**
 * DELETE /api/guilds/:guildId/warnings/:warningId
 * Remove a specific warning
 */
router.delete('/:guildId/warnings/:warningId', requireModeratePermission, async (req: Request, res: Response): Promise<void> => {
    try {
        const guildId = req.params.guildId!;
        const warningId = req.params.warningId!;

        const id = parseInt(warningId, 10);
        if (isNaN(id)) {
            res.status(400).json({ error: 'Invalid warning ID' });
            return;
        }

        // Verify warning belongs to this guild
        const [existing] = await db.select()
            .from(warnings)
            .where(and(
                eq(warnings.id, id),
                eq(warnings.guildId, guildId)
            ));

        if (!existing) {
            res.status(404).json({ error: 'Warning not found' });
            return;
        }

        await db.delete(warnings).where(eq(warnings.id, id));

        logger.info({ guildId, warningId: id, moderatorId: req.userId }, 'Warning deleted via dashboard');
        res.json({ success: true, message: 'Warning deleted' });
    } catch (error) {
        logger.error({ error }, 'Failed to delete warning');
        res.status(500).json({ error: 'Failed to delete warning' });
    }
});

/**
 * DELETE /api/guilds/:guildId/warnings/user/:userId
 * Clear all warnings for a user
 */
router.delete('/:guildId/warnings/user/:userId', requireModeratePermission, async (req: Request, res: Response): Promise<void> => {
    try {
        const guildId = req.params.guildId!;
        const userId = req.params.userId!;

        await db.delete(warnings)
            .where(and(
                eq(warnings.guildId, guildId),
                eq(warnings.userId, userId)
            ));

        logger.info({ guildId, userId, moderatorId: req.userId }, 'User warnings cleared via dashboard');
        res.json({ success: true, message: 'All warnings cleared for user' });
    } catch (error) {
        logger.error({ error }, 'Failed to clear warnings');
        res.status(500).json({ error: 'Failed to clear warnings' });
    }
});

/**
 * GET /api/guilds/:guildId/moderation/settings
 * Get moderation settings
 */
router.get('/:guildId/moderation/settings', requireManageGuild, async (req: Request, res: Response): Promise<void> => {
    try {
        const guildId = req.params.guildId!;

        const [settings] = await db.select()
            .from(moderationSettings)
            .where(eq(moderationSettings.guildId, guildId));

        res.json(settings || null);
    } catch (error) {
        logger.error({ error }, 'Failed to get moderation settings');
        res.status(500).json({ error: 'Failed to get moderation settings' });
    }
});

/**
 * PUT /api/guilds/:guildId/moderation/settings
 * Update moderation settings
 */
router.put('/:guildId/moderation/settings', requireManageGuild, async (req: Request, res: Response): Promise<void> => {
    try {
        const guildId = req.params.guildId!;
        const settings = req.body;

        // Check if settings exist
        const [existing] = await db.select()
            .from(moderationSettings)
            .where(eq(moderationSettings.guildId, guildId));

        if (existing) {
            await db.update(moderationSettings)
                .set({ ...settings, updatedAt: new Date() })
                .where(eq(moderationSettings.guildId, guildId));
        } else {
            await db.insert(moderationSettings)
                .values({ guildId, ...settings });
        }

        logger.info({ guildId, moderatorId: req.userId }, 'Moderation settings updated via dashboard');
        res.json({ success: true, message: 'Moderation settings updated' });
    } catch (error) {
        logger.error({ error }, 'Failed to update moderation settings');
        res.status(500).json({ error: 'Failed to update moderation settings' });
    }
});

/**
 * GET /api/guilds/:guildId/moderation/overview
 * Get moderation overview stats
 */
router.get('/:guildId/moderation/overview', requireManageGuild, async (req: Request, res: Response): Promise<void> => {
    try {
        const guildId = req.params.guildId!;
        const client = req.discordClient;

        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            res.status(404).json({ error: 'Guild not found' });
            return;
        }

        // Get warning count
        const [warningCount] = await db.select({ count: count() })
            .from(warnings)
            .where(eq(warnings.guildId, guildId));

        // Get ban count
        const bans = await guild.bans.fetch();

        // Get moderation settings
        const [settings] = await db.select()
            .from(moderationSettings)
            .where(eq(moderationSettings.guildId, guildId));

        res.json({
            totalWarnings: warningCount?.count || 0,
            totalBans: bans.size,
            autoModEnabled: settings?.autoModEnabled || false,
            antiSpamEnabled: settings?.antiSpamEnabled || false,
            antiRaidEnabled: settings?.antiRaidEnabled || false,
            warnThreshold: settings?.warnThreshold || 3,
            warnAction: settings?.warnAction || 'mute',
        });
    } catch (error) {
        logger.error({ error }, 'Failed to get moderation overview');
        res.status(500).json({ error: 'Failed to get moderation overview' });
    }
});

export { router as moderationRouter };
