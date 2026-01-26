import { ChatInputCommandInteraction, GuildMember } from 'discord.js';
import type { KazagumoPlayer } from 'kazagumo';

export interface VoiceValidationSuccess {
    valid: true;
    player: KazagumoPlayer;
}

export interface VoiceValidationFailure {
    valid: false;
    message: string;
}

export type VoiceValidationResult = VoiceValidationSuccess | VoiceValidationFailure;

/**
 * Validates that a user is in the same voice channel as the bot's music player.
 * 
 * Use this for commands that modify playback state (skip, pause, volume, etc.)
 * Read-only commands like /queue and /lyrics don't need this check.
 * 
 * @returns Validation result with either the player or an error message
 */
export function validateVoiceChannel(
    interaction: ChatInputCommandInteraction,
    player: KazagumoPlayer | undefined
): VoiceValidationResult {
    // No player means nothing is playing - caller should handle this case
    if (!player) {
        return {
            valid: false,
            message: '❌ No music is currently playing.',
        };
    }

    const member = interaction.member as GuildMember | null;
    const userVoiceChannel = member?.voice?.channel?.id;

    // User isn't in any voice channel
    if (!userVoiceChannel) {
        return {
            valid: false,
            message: '❌ You must be in a voice channel to use this command.',
        };
    }

    // User is in a different voice channel than the bot
    if (userVoiceChannel !== player.voiceId) {
        return {
            valid: false,
            message: '❌ I\'m currently playing music in another channel. Please wait until I\'m available or join that channel.',
        };
    }

    return { valid: true, player };
}

/**
 * Validates voice channel for commands that create players (like /play).
 * Allows the command if no player exists, but requires same channel if one does.
 */
export function validateVoiceChannelForPlay(
    interaction: ChatInputCommandInteraction,
    player: KazagumoPlayer | undefined
): VoiceValidationResult | { valid: true; player: undefined } {
    // No player means we can create one - that's fine
    if (!player) {
        return { valid: true, player: undefined };
    }

    const member = interaction.member as GuildMember | null;
    const userVoiceChannel = member?.voice?.channel?.id;

    // User isn't in any voice channel
    if (!userVoiceChannel) {
        return {
            valid: false,
            message: '❌ You must be in a voice channel to use this command.',
        };
    }

    // User is in a different voice channel than the bot
    if (userVoiceChannel !== player.voiceId) {
        return {
            valid: false,
            message: '❌ I\'m currently playing music in another channel. Please wait until I\'m available or join that channel.',
        };
    }

    return { valid: true, player };
}
