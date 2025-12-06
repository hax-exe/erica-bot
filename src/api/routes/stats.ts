import { Router, Request, Response } from 'express';
import { requireManageGuild } from '../middleware/auth.js';
import { db } from '../../db/index.js';
import { guildMembers, warnings, guilds } from '../../db/schema/index.js';
import { eq, desc, count, sql } from 'drizzle-orm';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('api:stats');
const router = Router();

/**
 * GET /api/guilds/:guildId/stats/overview
 * Get general guild statistics
 */
router.get('/:guildId/stats/overview', requireManageGuild, async (req: Request, res: Response): Promise<void> => {
    try {
        const guildId = req.params.guildId!;
        const client = req.discordClient;

        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            res.status(404).json({ error: 'Guild not found' });
            return;
        }

        // Get counts from database
        const [memberCount] = await db.select({ count: count() })
            .from(guildMembers)
            .where(eq(guildMembers.guildId, guildId));

        const [warningCount] = await db.select({ count: count() })
            .from(warnings)
            .where(eq(warnings.guildId, guildId));

        // Calculate online members
        const onlineMembers = guild.members.cache.filter(
            m => m.presence?.status && m.presence.status !== 'offline'
        ).size;

        // Calculate bot vs human ratio
        const bots = guild.members.cache.filter(m => m.user.bot).size;
        const humans = guild.memberCount - bots;

        res.json({
            guild: {
                id: guild.id,
                name: guild.name,
                icon: guild.iconURL({ size: 256 }),
                banner: guild.bannerURL({ size: 512 }),
                description: guild.description,
            },
            members: {
                total: guild.memberCount,
                online: onlineMembers,
                humans,
                bots,
                trackedInDb: memberCount?.count || 0,
            },
            channels: {
                total: guild.channels.cache.size,
                text: guild.channels.cache.filter(c => c.isTextBased() && !c.isThread()).size,
                voice: guild.channels.cache.filter(c => c.isVoiceBased()).size,
                categories: guild.channels.cache.filter(c => c.type === 4).size,
            },
            roles: {
                total: guild.roles.cache.size - 1, // Exclude @everyone
            },
            moderation: {
                totalWarnings: warningCount?.count || 0,
            },
            boosts: {
                level: guild.premiumTier,
                count: guild.premiumSubscriptionCount || 0,
            },
            createdAt: guild.createdAt.toISOString(),
            botJoinedAt: guild.joinedAt?.toISOString(),
        });
    } catch (error) {
        logger.error({ error }, 'Failed to get stats overview');
        res.status(500).json({ error: 'Failed to get stats overview' });
    }
});

/**
 * GET /api/guilds/:guildId/stats/leaderboard
 * Get XP/Level leaderboard
 */
router.get('/:guildId/stats/leaderboard', requireManageGuild, async (req: Request, res: Response): Promise<void> => {
    try {
        const guildId = req.params.guildId!;
        const client = req.discordClient;
        const limit = Math.min(parseInt(req.query.limit as string) || 10, 100);

        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            res.status(404).json({ error: 'Guild not found' });
            return;
        }

        // Get top members by XP
        const topMembers = await db.select()
            .from(guildMembers)
            .where(eq(guildMembers.guildId, guildId))
            .orderBy(desc(guildMembers.xp))
            .limit(limit);

        // Enrich with Discord data
        const enrichedMembers = await Promise.all(
            topMembers.map(async (member, index) => {
                let username = 'Unknown User';
                let avatar = null;
                let displayName = 'Unknown User';

                try {
                    const user = await client.users.fetch(member.odId);
                    username = user.username;
                    avatar = user.displayAvatarURL({ size: 64 });

                    const guildMember = guild.members.cache.get(member.odId);
                    displayName = guildMember?.displayName || username;
                } catch {
                    // User not found
                }

                return {
                    rank: index + 1,
                    odId: member.odId,
                    username,
                    displayName,
                    avatar,
                    xp: member.xp,
                    level: member.level,
                    totalMessages: member.totalMessages,
                };
            })
        );

        res.json(enrichedMembers);
    } catch (error) {
        logger.error({ error }, 'Failed to get leaderboard');
        res.status(500).json({ error: 'Failed to get leaderboard' });
    }
});

/**
 * GET /api/guilds/:guildId/stats/economy
 * Get economy leaderboard
 */
router.get('/:guildId/stats/economy', requireManageGuild, async (req: Request, res: Response): Promise<void> => {
    try {
        const guildId = req.params.guildId!;
        const client = req.discordClient;
        const limit = Math.min(parseInt(req.query.limit as string) || 10, 100);

        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            res.status(404).json({ error: 'Guild not found' });
            return;
        }

        // Get top members by total wealth (balance + bank)
        const topMembers = await db.select()
            .from(guildMembers)
            .where(eq(guildMembers.guildId, guildId))
            .orderBy(desc(sql`${guildMembers.balance} + ${guildMembers.bank}`))
            .limit(limit);

        // Enrich with Discord data
        const enrichedMembers = await Promise.all(
            topMembers.map(async (member, index) => {
                let username = 'Unknown User';
                let avatar = null;

                try {
                    const user = await client.users.fetch(member.odId);
                    username = user.username;
                    avatar = user.displayAvatarURL({ size: 64 });
                } catch {
                    // User not found
                }

                return {
                    rank: index + 1,
                    odId: member.odId,
                    username,
                    avatar,
                    balance: member.balance,
                    bank: member.bank,
                    totalWealth: (member.balance || 0) + (member.bank || 0),
                };
            })
        );

        res.json(enrichedMembers);
    } catch (error) {
        logger.error({ error }, 'Failed to get economy leaderboard');
        res.status(500).json({ error: 'Failed to get economy leaderboard' });
    }
});

/**
 * GET /api/stats/bot
 * Get global bot statistics (no guild required)
 */
router.get('/bot', async (req: Request, res: Response): Promise<void> => {
    try {
        const client = req.discordClient;

        // Calculate total users across all guilds
        const totalUsers = client.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0);

        // Get total guilds tracked in database
        const [guildCount] = await db.select({ count: count() }).from(guilds);

        res.json({
            guilds: {
                total: client.guilds.cache.size,
                trackedInDb: guildCount?.count || 0,
            },
            users: {
                total: totalUsers,
                cached: client.users.cache.size,
            },
            uptime: process.uptime(),
            memory: {
                used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
            },
            shards: client.shard?.count || 1,
            ping: client.ws.ping,
        });
    } catch (error) {
        logger.error({ error }, 'Failed to get bot stats');
        res.status(500).json({ error: 'Failed to get bot stats' });
    }
});

export { router as statsRouter };
