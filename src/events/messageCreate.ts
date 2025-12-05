import { Events, Message, GuildMember, EmbedBuilder, TextChannel } from 'discord.js';
import { Event } from '../types/Event.js';
import { createLogger } from '../utils/logger.js';
import { db } from '../db/index.js';
import { guilds, levelingSettings } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';
import {
    addXp,
    isChannelIgnored,
    hasIgnoredRole,
    getRoleRewardsForLevel,
} from '../services/leveling.js';
import { checkMessage, takeAction } from '../services/automod.js';
import { checkAutoResponders } from '../services/autoResponder.js';

const logger = createLogger('message-xp');

export default new Event({
    name: Events.MessageCreate,
    async execute(client, message: Message) {
        // Ignore bots, DMs, and system messages
        if (message.author.bot || !message.guild || message.system) return;

        // Run auto-moderation first
        const automodResult = await checkMessage(message);
        if (automodResult.shouldDelete) {
            await takeAction(message, automodResult);
            return; // Don't process XP for deleted messages
        }

        // Check auto-responders
        await checkAutoResponders(message);

        // Check if leveling is enabled
        const guild = await db.query.guilds.findFirst({
            where: eq(guilds.id, message.guild.id),
        });

        if (!guild?.levelingEnabled) return;

        // Check if channel is ignored
        if (await isChannelIgnored(message.guild.id, message.channel.id)) return;

        // Check if user has ignored role
        const member = message.member;
        if (!member) return;

        const roleIds = member.roles.cache.map((r) => r.id);
        if (await hasIgnoredRole(message.guild.id, roleIds)) return;

        // Add XP
        const result = await addXp(message.guild.id, message.author.id);
        if (!result) return; // On cooldown

        // Handle level up
        if (result.leveledUp) {
            await handleLevelUp(message, member, result.newLevel);
        }
    },
});

async function handleLevelUp(
    message: Message,
    member: GuildMember,
    newLevel: number
): Promise<void> {
    const guildId = message.guild!.id;

    // Get leveling settings
    const settings = await db.query.levelingSettings.findFirst({
        where: eq(levelingSettings.guildId, guildId),
    });

    // Apply role rewards
    const rewardRoles = await getRoleRewardsForLevel(guildId, newLevel);
    for (const roleId of rewardRoles) {
        if (!member.roles.cache.has(roleId)) {
            try {
                await member.roles.add(roleId);
                logger.debug({ guildId, userId: member.id, roleId, level: newLevel }, 'Added level reward role');
            } catch (error) {
                logger.error({ error, roleId }, 'Failed to add level reward role');
            }
        }
    }

    // Send level up announcement if enabled
    if (!settings?.announceEnabled) return;

    const announceMessage = (settings.announceMessage || '🎉 Congratulations {user}! You reached level {level}!')
        .replace('{user}', `<@${member.id}>`)
        .replace('{level}', String(newLevel))
        .replace('{username}', member.user.username);

    const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('🎉 Level Up!')
        .setDescription(announceMessage)
        .setThumbnail(member.displayAvatarURL())
        .setTimestamp();

    // Determine where to send the announcement
    let targetChannel: TextChannel | null = null;

    if (settings.announceChannelId) {
        // Custom channel
        const channel = message.guild!.channels.cache.get(settings.announceChannelId);
        if (channel?.isTextBased() && 'send' in channel) {
            targetChannel = channel as TextChannel;
        }
    } else {
        // Current channel
        if (message.channel.isTextBased() && 'send' in message.channel) {
            targetChannel = message.channel as TextChannel;
        }
    }

    if (targetChannel) {
        try {
            await targetChannel.send({ embeds: [embed] });
        } catch (error) {
            logger.error({ error }, 'Failed to send level up announcement');
        }
    }
}
