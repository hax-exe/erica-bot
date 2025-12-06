import { Request, Response, NextFunction } from 'express';
import { PermissionFlagsBits } from 'discord.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('api:auth');

/**
 * Middleware to verify that the requesting user has permission to manage the guild
 * This checks:
 * 1. The guild exists and the bot is a member
 * 2. The user is a member of the guild
 * 3. The user has MANAGE_GUILD permission
 */
export function requireGuildPermission(permission: bigint = PermissionFlagsBits.ManageGuild) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const { guildId } = req.params;
        const userId = req.userId;

        if (!userId) {
            res.status(401).json({ error: 'User ID required' });
            return;
        }

        if (!guildId) {
            res.status(400).json({ error: 'Guild ID required' });
            return;
        }

        try {
            const client = req.discordClient;

            // Check if bot is in the guild
            const guild = client.guilds.cache.get(guildId);
            if (!guild) {
                res.status(404).json({ error: 'Guild not found or bot is not a member' });
                return;
            }

            // Try to fetch the member
            let member;
            try {
                member = await guild.members.fetch(userId);
            } catch {
                res.status(403).json({ error: 'You are not a member of this guild' });
                return;
            }

            // Check permissions
            if (!member.permissions.has(permission)) {
                logger.warn({ userId, guildId, permission: permission.toString() },
                    'Permission denied for guild action');
                res.status(403).json({ error: 'Insufficient permissions' });
                return;
            }

            // Attach guild and member to request for use in route handlers
            req.guildId = guildId;

            next();
        } catch (error) {
            logger.error({ error, guildId, userId }, 'Error verifying guild permission');
            res.status(500).json({ error: 'Failed to verify permissions' });
        }
    };
}

/**
 * Middleware to require BAN_MEMBERS permission
 */
export const requireBanPermission = requireGuildPermission(PermissionFlagsBits.BanMembers);

/**
 * Middleware to require KICK_MEMBERS permission
 */
export const requireKickPermission = requireGuildPermission(PermissionFlagsBits.KickMembers);

/**
 * Middleware to require MODERATE_MEMBERS permission
 */
export const requireModeratePermission = requireGuildPermission(PermissionFlagsBits.ModerateMembers);

/**
 * Middleware to require MANAGE_GUILD permission (default)
 */
export const requireManageGuild = requireGuildPermission(PermissionFlagsBits.ManageGuild);

/**
 * Middleware to require Administrator permission
 */
export const requireAdmin = requireGuildPermission(PermissionFlagsBits.Administrator);
