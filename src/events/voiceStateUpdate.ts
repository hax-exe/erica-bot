import { Events, VoiceState, TextChannel } from 'discord.js';
import { Event } from '../types/Event.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('voice-state');

// Store inactivity timeouts per guild (when bot is alone)
const inactivityTimeouts = new Map<string, NodeJS.Timeout>();

// Store playback inactivity timeouts per guild (when no music is playing)
const playbackInactivityTimeouts = new Map<string, NodeJS.Timeout>();

// Inactivity duration when bot is alone: 2 minutes
const INACTIVITY_TIMEOUT_MS = 2 * 60 * 1000;

// Playback inactivity duration: 2 minutes
const PLAYBACK_INACTIVITY_TIMEOUT_MS = 2 * 60 * 1000;

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

function clearInactivityTimeout(guildId: string): void {
    const timeout = inactivityTimeouts.get(guildId);
    if (timeout) {
        clearTimeout(timeout);
        inactivityTimeouts.delete(guildId);
        logger.debug({ guildId }, 'Cleared inactivity timeout');
    }
}

/**
 * Start a 5-minute timeout when there's no playback.
 * This runs even when users are present in the channel.
 */
function startPlaybackInactivityTimeout(
    guildId: string,
    player: any,
    textChannelId: string | null | undefined,
    client: any
): void {
    // Clear any existing playback timeout
    clearPlaybackInactivityTimeout(guildId);

    logger.debug({ guildId }, 'Starting 2-minute playback inactivity timeout');

    const timeout = setTimeout(async () => {
        // Remove from map
        playbackInactivityTimeouts.delete(guildId);

        // Check if player still exists and is still not playing
        const currentPlayer = client.music.players.get(guildId);
        if (!currentPlayer) return;

        // If music started playing in the meantime, don't leave
        if (currentPlayer.playing || currentPlayer.paused) {
            logger.debug({ guildId }, 'Playback resumed, cancelling leave');
            return;
        }

        // Send inactivity message
        if (textChannelId) {
            try {
                const channel = client.channels.cache.get(textChannelId) as TextChannel | undefined;
                if (channel?.isTextBased() && 'send' in channel) {
                    await channel.send('👋 Left due to no music playing for 2 minutes. Use `/play` to start again!');
                }
            } catch (error) {
                logger.debug({ error }, 'Failed to send playback inactivity message');
            }
        }

        // Destroy the player
        logger.info({ guildId }, 'Destroying player due to playback inactivity');
        currentPlayer.destroy();
    }, PLAYBACK_INACTIVITY_TIMEOUT_MS);

    playbackInactivityTimeouts.set(guildId, timeout);
}

/**
 * Clear the playback inactivity timeout (called when music starts playing)
 */
function clearPlaybackInactivityTimeout(guildId: string): void {
    const timeout = playbackInactivityTimeouts.get(guildId);
    if (timeout) {
        clearTimeout(timeout);
        playbackInactivityTimeouts.delete(guildId);
        logger.debug({ guildId }, 'Cleared playback inactivity timeout');
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

// Export for use in other modules
export {
    clearInactivityTimeout,
    startInactivityTimeout,
    clearPlaybackInactivityTimeout,
    startPlaybackInactivityTimeout,
};

