import { Message, EmbedBuilder, TextChannel } from 'discord.js';
import { db } from '../db/index.js';
import { moderationSettings, warnings } from '../db/schema/index.js';
import { eq, and, sql } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('automod');

// Spam tracking: guildId:userId -> { count, lastMessage, timestamps }
const spamTracker = new Map<string, {
    count: number;
    lastMessage: string;
    timestamps: number[];
}>();

// Link regex
const LINK_REGEX = /https?:\/\/[^\s]+/gi;
const DISCORD_INVITE_REGEX = /(discord\.(gg|io|me|li)|discordapp\.com\/invite)\/[a-zA-Z0-9]+/gi;

interface AutoModResult {
    shouldDelete: boolean;
    reason?: string;
    action?: 'warn' | 'mute' | 'kick' | 'ban';
}

/**
 * Check a message against auto-moderation rules
 */
export async function checkMessage(message: Message): Promise<AutoModResult> {
    if (!message.guild || message.author.bot) {
        return { shouldDelete: false };
    }

    // Get moderation settings
    const settings = await db.query.moderationSettings.findFirst({
        where: eq(moderationSettings.guildId, message.guild.id),
    });

    if (!settings?.autoModEnabled) {
        return { shouldDelete: false };
    }

    // Check banned words
    const bannedWordsResult = checkBannedWords(message.content, settings.bannedWords || []);
    if (bannedWordsResult.shouldDelete) {
        return bannedWordsResult;
    }

    // Check Discord invites
    const inviteResult = await checkInvites(message, settings.allowedInvites || []);
    if (inviteResult.shouldDelete) {
        return inviteResult;
    }

    // Check spam
    if (settings.antiSpamEnabled) {
        const spamResult = checkSpam(message);
        if (spamResult.shouldDelete) {
            return spamResult;
        }
    }

    // Check excessive caps
    const capsResult = checkExcessiveCaps(message.content);
    if (capsResult.shouldDelete) {
        return capsResult;
    }

    // Check excessive emojis
    const emojiResult = checkExcessiveEmojis(message.content);
    if (emojiResult.shouldDelete) {
        return emojiResult;
    }

    // Check mass mentions
    const mentionResult = checkMassMentions(message);
    if (mentionResult.shouldDelete) {
        return mentionResult;
    }

    return { shouldDelete: false };
}

/**
 * Check for banned words
 */
function checkBannedWords(content: string, bannedWords: string[]): AutoModResult {
    if (bannedWords.length === 0) {
        return { shouldDelete: false };
    }

    const lowerContent = content.toLowerCase();

    for (const word of bannedWords) {
        if (lowerContent.includes(word.toLowerCase())) {
            return {
                shouldDelete: true,
                reason: 'Banned word detected',
                action: 'warn',
            };
        }
    }

    return { shouldDelete: false };
}

/**
 * Check for Discord invites
 */
async function checkInvites(message: Message, allowedInvites: string[]): Promise<AutoModResult> {
    const invites = message.content.match(DISCORD_INVITE_REGEX);

    if (!invites) {
        return { shouldDelete: false };
    }

    // Check if any invites are not in the allowed list
    for (const invite of invites) {
        const code = invite.split('/').pop() || '';
        if (!allowedInvites.includes(code)) {
            return {
                shouldDelete: true,
                reason: 'Discord invite link not allowed',
                action: 'warn',
            };
        }
    }

    return { shouldDelete: false };
}

/**
 * Check for spam (repeated messages, fast messages)
 */
function checkSpam(message: Message): AutoModResult {
    const key = `${message.guild!.id}:${message.author.id}`;
    const now = Date.now();
    const timeWindow = 5000; // 5 seconds
    const maxMessages = 5;
    const duplicateThreshold = 3;

    let tracker = spamTracker.get(key);

    if (!tracker) {
        tracker = {
            count: 0,
            lastMessage: '',
            timestamps: [],
        };
        spamTracker.set(key, tracker);
    }

    // Remove old timestamps
    tracker.timestamps = tracker.timestamps.filter((t) => now - t < timeWindow);
    tracker.timestamps.push(now);

    // Check for fast messaging
    if (tracker.timestamps.length >= maxMessages) {
        spamTracker.delete(key);
        return {
            shouldDelete: true,
            reason: 'Sending messages too quickly',
            action: 'mute',
        };
    }

    // Check for duplicate messages
    if (message.content === tracker.lastMessage) {
        tracker.count++;
        if (tracker.count >= duplicateThreshold) {
            spamTracker.delete(key);
            return {
                shouldDelete: true,
                reason: 'Sending duplicate messages',
                action: 'warn',
            };
        }
    } else {
        tracker.count = 1;
        tracker.lastMessage = message.content;
    }

    return { shouldDelete: false };
}

/**
 * Check for excessive capital letters
 */
function checkExcessiveCaps(content: string): AutoModResult {
    if (content.length < 10) {
        return { shouldDelete: false };
    }

    const letters = content.replace(/[^a-zA-Z]/g, '');
    if (letters.length < 10) {
        return { shouldDelete: false };
    }

    const caps = letters.replace(/[^A-Z]/g, '');
    const capsRatio = caps.length / letters.length;

    if (capsRatio > 0.7) {
        return {
            shouldDelete: true,
            reason: 'Excessive use of capital letters',
        };
    }

    return { shouldDelete: false };
}

/**
 * Check for excessive emojis
 */
function checkExcessiveEmojis(content: string): AutoModResult {
    // Match both unicode emojis and Discord custom emojis
    const emojiRegex = /(\p{Emoji_Presentation}|\p{Extended_Pictographic}|<a?:\w+:\d+>)/gu;
    const emojis = content.match(emojiRegex) || [];

    if (emojis.length > 10) {
        return {
            shouldDelete: true,
            reason: 'Excessive emojis',
        };
    }

    return { shouldDelete: false };
}

/**
 * Check for mass mentions
 */
function checkMassMentions(message: Message): AutoModResult {
    const mentions = message.mentions.users.size + message.mentions.roles.size;

    if (mentions > 5) {
        return {
            shouldDelete: true,
            reason: 'Mass mentioning users/roles',
            action: 'warn',
        };
    }

    if (message.mentions.everyone) {
        return {
            shouldDelete: true,
            reason: 'Attempting to mention everyone',
            action: 'warn',
        };
    }

    return { shouldDelete: false };
}

/**
 * Take action based on auto-mod result
 */
export async function takeAction(
    message: Message,
    result: AutoModResult
): Promise<void> {
    if (!result.shouldDelete) return;

    const { guild, author, channel } = message;
    if (!guild) return;

    // Delete the message
    try {
        await message.delete();
    } catch (error) {
        logger.error({ error }, 'Failed to delete message');
    }

    // Send notification
    const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('🛡️ Auto-Mod')
        .setDescription(`Message from ${author} was removed.`)
        .addFields({ name: 'Reason', value: result.reason || 'Violated auto-mod rules' })
        .setTimestamp();

    try {
        const sent = await (channel as TextChannel).send({ embeds: [embed] });
        // Delete notification after 5 seconds
        setTimeout(() => sent.delete().catch(() => { }), 5000);
    } catch (error) {
        logger.error({ error }, 'Failed to send automod notification');
    }

    // Take additional action if specified
    if (result.action === 'warn') {
        await db.insert(warnings).values({
            guildId: guild.id,
            userId: author.id,
            moderatorId: message.client.user!.id,
            reason: `[Auto-Mod] ${result.reason}`,
        });
    } else if (result.action === 'mute') {
        const member = guild.members.cache.get(author.id);
        if (member?.moderatable) {
            await member.timeout(5 * 60 * 1000, `[Auto-Mod] ${result.reason}`);
        }
    }

    logger.info({
        guildId: guild.id,
        userId: author.id,
        reason: result.reason,
        action: result.action,
    }, 'Auto-mod action taken');
}

/**
 * Clean up spam tracker periodically
 */
setInterval(() => {
    const now = Date.now();
    for (const [key, tracker] of spamTracker) {
        if (tracker.timestamps.every((t) => now - t > 60000)) {
            spamTracker.delete(key);
        }
    }
}, 60000);
