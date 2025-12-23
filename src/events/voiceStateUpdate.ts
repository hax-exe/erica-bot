import { Events, VoiceState, TextChannel } from 'discord.js';
import { Event } from '../types/Event.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('voice-state');

// Store inactivity timeouts per guild
const inactivityTimeouts = new Map<string, NodeJS.Timeout>();

// Inactivity duration: 2 minutes
const INACTIVITY_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * Start the inactivity timeout for a guild
 */
function startInactivityTimeout(
    guildId: string,
    player: any,
    textChannelId: string | null | undefined,
    client: any
): void {
    // Clear any existing timeout
    clearInactivityTimeout(guildId);

    logger.debug({ guildId }, 'Starting 2-minute inactivity timeout');

    const timeout = setTimeout(async () => {
        // Remove from map
        inactivityTimeouts.delete(guildId);

        // Check if player still exists
        const currentPlayer = client.music.players.get(guildId);
        if (!currentPlayer) return;

        // Send inactivity message
        if (textChannelId) {
            try {
                const channel = client.channels.cache.get(textChannelId) as TextChannel | undefined;
                if (channel?.isTextBased() && 'send' in channel) {
                    await channel.send('👋 Left the voice channel due to inactivity.');
                }
            } catch (error) {
                logger.debug({ error }, 'Failed to send inactivity message');
            }
        }

        // Destroy the player
        logger.info({ guildId }, 'Destroying player due to inactivity');
        currentPlayer.destroy();
    }, INACTIVITY_TIMEOUT_MS);

    inactivityTimeouts.set(guildId, timeout);
}

/**
 * Clear the inactivity timeout for a guild
 */
function clearInactivityTimeout(guildId: string): void {
    const timeout = inactivityTimeouts.get(guildId);
    if (timeout) {
        clearTimeout(timeout);
        inactivityTimeouts.delete(guildId);
        logger.debug({ guildId }, 'Cleared inactivity timeout');
    }
}

export default new Event({
    name: Events.VoiceStateUpdate,

    async execute(client, oldState: VoiceState, newState: VoiceState) {
        const guildId = newState.guild.id;
        const player = client.music.players.get(guildId);

        // No player active for this guild, nothing to do
        if (!player) return;

        const botId = client.user?.id;
        if (!botId) return;

        const botVoiceChannelId = player.voiceId;
        if (!botVoiceChannelId) return;

        // Check if this voice state update is relevant to the bot's channel
        const isOldStateInBotChannel = oldState.channelId === botVoiceChannelId;
        const isNewStateInBotChannel = newState.channelId === botVoiceChannelId;

        // If someone left the bot's channel
        if (isOldStateInBotChannel && !isNewStateInBotChannel) {
            // Check if bot is now alone
            const botChannel = newState.guild.channels.cache.get(botVoiceChannelId);
            if (botChannel?.isVoiceBased()) {
                const humanMembers = botChannel.members.filter(member => !member.user.bot);

                if (humanMembers.size === 0) {
                    // Bot is alone, start inactivity timeout
                    startInactivityTimeout(guildId, player, player.textId, client);
                }
            }
        }

        // If someone joined the bot's channel
        if (!isOldStateInBotChannel && isNewStateInBotChannel) {
            // Someone joined, cancel any inactivity timeout
            if (!newState.member?.user.bot) {
                clearInactivityTimeout(guildId);
            }
        }
    },
});

// Export for use in other modules if needed
export { clearInactivityTimeout, startInactivityTimeout };
