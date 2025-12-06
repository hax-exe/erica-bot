import { Router, Request, Response } from 'express';
import { requireManageGuild, requireBanPermission, requireKickPermission } from '../middleware/auth.js';
import { db } from '../../db/index.js';
import { guildMembers, warnings } from '../../db/schema/index.js';
import { eq, and, sql, desc } from 'drizzle-orm';
import { createLogger } from '../../utils/logger.js';
import { z } from 'zod';

const logger = createLogger('api:members');
const router = Router();

// Validation schemas
const paginationSchema = z.object({
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(100).default(50),
    search: z.string().optional(),
});

const banSchema = z.object({
    reason: z.string().max(500).default('Banned via dashboard'),
    deleteMessageDays: z.coerce.number().min(0).max(7).default(0),
});

const kickSchema = z.object({
    reason: z.string().max(500).default('Kicked via dashboard'),
});

/**
 * GET /api/guilds/:guildId/members
 * List guild members with pagination
 */
router.get('/:guildId/members', requireManageGuild, async (req: Request, res: Response): Promise<void> => {
    try {
        const guildId = req.params.guildId!;
        const client = req.discordClient;

        const query = paginationSchema.safeParse(req.query);
        if (!query.success) {
            res.status(400).json({ error: 'Invalid query parameters', details: query.error.issues });
            return;
        }

        const { page, limit, search } = query.data;
        const guild = client.guilds.cache.get(guildId);

        if (!guild) {
            res.status(404).json({ error: 'Guild not found' });
            return;
        }

        // Fetch members from Discord (this is cached)
        let members = [...guild.members.cache.values()];

        // Filter by search if provided
        if (search) {
            const searchLower = search.toLowerCase();
            members = members.filter(m =>
                m.user.username.toLowerCase().includes(searchLower) ||
                m.displayName.toLowerCase().includes(searchLower) ||
                m.user.id.includes(search)
            );
        }

        // Sort by join date (newest first)
        members.sort((a, b) => (b.joinedTimestamp || 0) - (a.joinedTimestamp || 0));

        // Paginate
        const total = members.length;
        const totalPages = Math.ceil(total / limit);
        const offset = (page - 1) * limit;
        const paginatedMembers = members.slice(offset, offset + limit);

        // Get XP data for these members
        const memberIds = paginatedMembers.map(m => m.user.id);
        const xpData = memberIds.length > 0 ? await db.select()
            .from(guildMembers)
            .where(
                and(
                    eq(guildMembers.guildId, guildId),
                    sql`${guildMembers.odId} = ANY(${memberIds})`
                )
            ) : [];

        const xpMap = new Map(xpData.map(d => [d.odId, d]));

        const response = paginatedMembers.map(m => {
            const memberData = xpMap.get(m.user.id);
            return {
                id: m.user.id,
                username: m.user.username,
                displayName: m.displayName,
                avatar: m.user.displayAvatarURL({ size: 64 }),
                joinedAt: m.joinedAt?.toISOString(),
                roles: m.roles.cache
                    .filter(r => r.id !== guildId)
                    .map(r => ({ id: r.id, name: r.name, color: r.hexColor }))
                    .sort((a, b) => b.color.localeCompare(a.color)),
                isOwner: m.id === guild.ownerId,
                isBot: m.user.bot,
                xp: memberData?.xp || 0,
                level: memberData?.level || 0,
                balance: memberData?.balance || 0,
                totalMessages: memberData?.totalMessages || 0,
            };
        });

        res.json({
            members: response,
            pagination: {
                page,
                limit,
                total,
                totalPages,
            },
        });
    } catch (error) {
        logger.error({ error }, 'Failed to get members');
        res.status(500).json({ error: 'Failed to get members' });
    }
});

/**
 * GET /api/guilds/:guildId/members/:userId
 * Get detailed information about a specific member
 */
router.get('/:guildId/members/:userId', requireManageGuild, async (req: Request, res: Response): Promise<void> => {
    try {
        const guildId = req.params.guildId!;
        const userId = req.params.userId!;
        const client = req.discordClient;

        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            res.status(404).json({ error: 'Guild not found' });
            return;
        }

        let member;
        try {
            member = await guild.members.fetch(userId);
        } catch {
            res.status(404).json({ error: 'Member not found' });
            return;
        }

        // Get member data from database
        const [memberData] = await db.select()
            .from(guildMembers)
            .where(and(
                eq(guildMembers.guildId, guildId),
                eq(guildMembers.odId, userId)
            ));

        // Get warnings
        const memberWarnings = await db.select()
            .from(warnings)
            .where(and(
                eq(warnings.guildId, guildId),
                eq(warnings.userId, userId)
            ))
            .orderBy(desc(warnings.createdAt));

        res.json({
            id: member.user.id,
            username: member.user.username,
            displayName: member.displayName,
            discriminator: member.user.discriminator,
            avatar: member.user.displayAvatarURL({ size: 256 }),
            banner: member.user.bannerURL({ size: 512 }),
            accentColor: member.user.accentColor,
            joinedAt: member.joinedAt?.toISOString(),
            createdAt: member.user.createdAt.toISOString(),
            roles: member.roles.cache
                .filter(r => r.id !== guildId)
                .map(r => ({ id: r.id, name: r.name, color: r.hexColor, position: r.position }))
                .sort((a, b) => b.position - a.position),
            permissions: member.permissions.toArray(),
            isOwner: member.id === guild.ownerId,
            isBot: member.user.bot,
            isPending: member.pending,
            communicationDisabledUntil: member.communicationDisabledUntil?.toISOString(),
            // Database data
            xp: memberData?.xp || 0,
            level: memberData?.level || 0,
            balance: memberData?.balance || 0,
            bank: memberData?.bank || 0,
            totalMessages: memberData?.totalMessages || 0,
            lastXpGain: memberData?.lastXpGain?.toISOString(),
            lastDaily: memberData?.lastDaily?.toISOString(),
            birthday: memberData?.birthday?.toISOString(),
            warnings: memberWarnings,
        });
    } catch (error) {
        logger.error({ error }, 'Failed to get member');
        res.status(500).json({ error: 'Failed to get member' });
    }
});

/**
 * POST /api/guilds/:guildId/members/:userId/ban
 * Ban a member from the guild
 */
router.post('/:guildId/members/:userId/ban', requireBanPermission, async (req: Request, res: Response): Promise<void> => {
    try {
        const guildId = req.params.guildId!;
        const userId = req.params.userId!;
        const client = req.discordClient;

        const body = banSchema.safeParse(req.body);
        if (!body.success) {
            res.status(400).json({ error: 'Invalid request body', details: body.error.issues });
            return;
        }

        const { reason, deleteMessageDays } = body.data;

        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            res.status(404).json({ error: 'Guild not found' });
            return;
        }

        // Check if trying to ban self
        if (userId === req.userId) {
            res.status(400).json({ error: 'You cannot ban yourself' });
            return;
        }

        // Check if trying to ban the bot
        if (userId === client.user?.id) {
            res.status(400).json({ error: 'Cannot ban the bot' });
            return;
        }

        // Try to fetch the member to check role hierarchy
        try {
            const member = await guild.members.fetch(userId);
            const botMember = guild.members.me;
            const executingMember = await guild.members.fetch(req.userId!);

            // Check role hierarchy
            if (botMember && member.roles.highest.position >= botMember.roles.highest.position) {
                res.status(400).json({ error: 'Cannot ban this user - their role is higher than the bot\'s' });
                return;
            }

            if (member.roles.highest.position >= executingMember.roles.highest.position) {
                res.status(400).json({ error: 'Cannot ban this user - their role is higher than or equal to yours' });
                return;
            }
        } catch {
            // Member not in guild - can still ban by ID
        }

        // Execute ban
        await guild.members.ban(userId, {
            reason: `${reason} | Banned via dashboard by ${req.userId}`,
            deleteMessageSeconds: deleteMessageDays * 24 * 60 * 60,
        });

        logger.info({ guildId, userId, moderatorId: req.userId, reason }, 'Member banned via dashboard');
        res.json({ success: true, message: `User ${userId} has been banned` });
    } catch (error) {
        logger.error({ error }, 'Failed to ban member');
        res.status(500).json({ error: 'Failed to ban member' });
    }
});

/**
 * POST /api/guilds/:guildId/members/:userId/kick
 * Kick a member from the guild
 */
router.post('/:guildId/members/:userId/kick', requireKickPermission, async (req: Request, res: Response): Promise<void> => {
    try {
        const guildId = req.params.guildId!;
        const userId = req.params.userId!;
        const client = req.discordClient;

        const body = kickSchema.safeParse(req.body);
        if (!body.success) {
            res.status(400).json({ error: 'Invalid request body', details: body.error.issues });
            return;
        }

        const { reason } = body.data;

        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            res.status(404).json({ error: 'Guild not found' });
            return;
        }

        // Check if trying to kick self
        if (userId === req.userId) {
            res.status(400).json({ error: 'You cannot kick yourself' });
            return;
        }

        // Fetch target member
        let member;
        try {
            member = await guild.members.fetch(userId);
        } catch {
            res.status(404).json({ error: 'Member not found' });
            return;
        }

        const botMember = guild.members.me;
        const executingMember = await guild.members.fetch(req.userId!);

        // Check role hierarchy
        if (botMember && member.roles.highest.position >= botMember.roles.highest.position) {
            res.status(400).json({ error: 'Cannot kick this user - their role is higher than the bot\'s' });
            return;
        }

        if (member.roles.highest.position >= executingMember.roles.highest.position) {
            res.status(400).json({ error: 'Cannot kick this user - their role is higher than or equal to yours' });
            return;
        }

        // Execute kick
        await member.kick(`${reason} | Kicked via dashboard by ${req.userId}`);

        logger.info({ guildId, userId, moderatorId: req.userId, reason }, 'Member kicked via dashboard');
        res.json({ success: true, message: `User ${userId} has been kicked` });
    } catch (error) {
        logger.error({ error }, 'Failed to kick member');
        res.status(500).json({ error: 'Failed to kick member' });
    }
});

/**
 * DELETE /api/guilds/:guildId/bans/:userId
 * Unban a user from the guild
 */
router.delete('/:guildId/bans/:userId', requireBanPermission, async (req: Request, res: Response): Promise<void> => {
    try {
        const guildId = req.params.guildId!;
        const userId = req.params.userId!;
        const client = req.discordClient;

        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            res.status(404).json({ error: 'Guild not found' });
            return;
        }

        // Check if user is actually banned
        try {
            await guild.bans.fetch(userId);
        } catch {
            res.status(404).json({ error: 'User is not banned' });
            return;
        }

        // Unban
        await guild.members.unban(userId, `Unbanned via dashboard by ${req.userId}`);

        logger.info({ guildId, userId, moderatorId: req.userId }, 'User unbanned via dashboard');
        res.json({ success: true, message: `User ${userId} has been unbanned` });
    } catch (error) {
        logger.error({ error }, 'Failed to unban user');
        res.status(500).json({ error: 'Failed to unban user' });
    }
});

/**
 * GET /api/guilds/:guildId/bans
 * List all banned users
 */
router.get('/:guildId/bans', requireBanPermission, async (req: Request, res: Response): Promise<void> => {
    try {
        const guildId = req.params.guildId!;
        const client = req.discordClient;

        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            res.status(404).json({ error: 'Guild not found' });
            return;
        }

        const bans = await guild.bans.fetch();

        const response = bans.map(ban => ({
            odId: ban.user.id,
            username: ban.user.username,
            avatar: ban.user.displayAvatarURL({ size: 64 }),
            reason: ban.reason,
        }));

        res.json(response);
    } catch (error) {
        logger.error({ error }, 'Failed to get bans');
        res.status(500).json({ error: 'Failed to get bans' });
    }
});

export { router as membersRouter };
