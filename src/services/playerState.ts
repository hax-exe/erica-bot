import { getRedisClient, REDIS_KEYS } from './redis.js';
import { createLogger } from '../utils/logger.js';
import type { KazagumoPlayer, KazagumoTrack } from 'kazagumo';
import type { ExtendedClient } from '../structures/Client.js';

const logger = createLogger('player-state');

// TTL for player state in Redis (5 minutes)
const PLAYER_STATE_TTL = 5 * 60 * 1000;

// How often to save state while playing (5 seconds)
const SAVE_INTERVAL = 5000;

/**
 * Serializable player state for persistence.
 */
export interface PlayerState {
    guildId: string;
    voiceChannelId: string;
    textChannelId: string;
    currentTrack: {
        uri: string;
        title: string;
        author: string;
        position: number;  // Playback position in ms
        duration: number;
    } | null;
    queue: Array<{
        uri: string;
        title: string;
        author: string;
        duration: number;
    }>;
    volume: number;
    loop: 'none' | 'track' | 'queue';
    paused: boolean;
    updatedAt: number;
}

/**
 * Tracks which players are being auto-saved.
 */
const saveTimers = new Map<string, NodeJS.Timeout>();

/**
 * Save a player's state to Redis.
 */
export async function savePlayerState(player: KazagumoPlayer): Promise<void> {
    const redis = getRedisClient();

    const currentTrack = player.queue.current;
    const state: PlayerState = {
        guildId: player.guildId,
        voiceChannelId: player.voiceId || '',
        textChannelId: player.textId || '',
        currentTrack: currentTrack ? {
            uri: currentTrack.uri || '',
            title: currentTrack.title || 'Unknown',
            author: currentTrack.author || 'Unknown',
            position: player.position || 0,
            duration: currentTrack.length || 0,
        } : null,
        queue: player.queue.map(track => ({
            uri: track.uri || '',
            title: track.title || 'Unknown',
            author: track.author || 'Unknown',
            duration: track.length || 0,
        })),
        volume: player.volume,
        loop: player.loop as 'none' | 'track' | 'queue',
        paused: player.paused,
        updatedAt: Date.now(),
    };

    await redis.set(
        REDIS_KEYS.PLAYER_STATE(player.guildId),
        JSON.stringify(state),
        'PX',
        PLAYER_STATE_TTL
    );

    logger.debug({ guildId: player.guildId }, 'Player state saved');
}

/**
 * Get a saved player state from Redis.
 */
export async function getPlayerState(guildId: string): Promise<PlayerState | null> {
    const redis = getRedisClient();
    const data = await redis.get(REDIS_KEYS.PLAYER_STATE(guildId));

    if (!data) return null;

    try {
        return JSON.parse(data) as PlayerState;
    } catch {
        logger.warn({ guildId }, 'Failed to parse player state');
        return null;
    }
}

/**
 * Get all saved player states from Redis.
 */
export async function getAllPlayerStates(): Promise<PlayerState[]> {
    const redis = getRedisClient();
    const keys = await redis.keys(REDIS_KEYS.PLAYER_STATE('*'));

    if (keys.length === 0) return [];

    const states: PlayerState[] = [];
    for (const key of keys) {
        const data = await redis.get(key);
        if (data) {
            try {
                states.push(JSON.parse(data) as PlayerState);
            } catch {
                logger.warn({ key }, 'Failed to parse player state');
            }
        }
    }

    return states;
}

/**
 * Delete a player's saved state.
 */
export async function deletePlayerState(guildId: string): Promise<void> {
    const redis = getRedisClient();
    await redis.del(REDIS_KEYS.PLAYER_STATE(guildId));
    logger.debug({ guildId }, 'Player state deleted');
}

/**
 * Start auto-saving a player's state periodically.
 */
export function startAutoSave(player: KazagumoPlayer): void {
    // Clear existing timer if any
    stopAutoSave(player.guildId);

    const timer = setInterval(async () => {
        if (player.playing || player.paused) {
            await savePlayerState(player);
        }
    }, SAVE_INTERVAL);

    saveTimers.set(player.guildId, timer);
    logger.debug({ guildId: player.guildId }, 'Started auto-save for player');
}

/**
 * Stop auto-saving a player's state.
 */
export function stopAutoSave(guildId: string): void {
    const timer = saveTimers.get(guildId);
    if (timer) {
        clearInterval(timer);
        saveTimers.delete(guildId);
        logger.debug({ guildId }, 'Stopped auto-save for player');
    }
}

/**
 * Stop all auto-save timers.
 */
export function stopAllAutoSaves(): void {
    for (const [guildId, timer] of saveTimers) {
        clearInterval(timer);
    }
    saveTimers.clear();
    logger.debug('Stopped all auto-saves');
}

/**
 * Restore all saved player states after failover.
 * This reconnects to voice channels and resumes playback.
 */
export async function restorePlayerStates(client: ExtendedClient): Promise<number> {
    const states = await getAllPlayerStates();

    if (states.length === 0) {
        logger.info('No player states to restore');
        return 0;
    }

    logger.info({ count: states.length }, 'Restoring player states after failover');
    let restored = 0;

    for (const state of states) {
        try {
            // Check if we have access to the guild
            const guild = client.guilds.cache.get(state.guildId);
            if (!guild) {
                logger.warn({ guildId: state.guildId }, 'Guild not found, skipping restore');
                await deletePlayerState(state.guildId);
                continue;
            }

            // Check if voice channel exists
            const voiceChannel = guild.channels.cache.get(state.voiceChannelId);
            if (!voiceChannel?.isVoiceBased()) {
                logger.warn({ guildId: state.guildId }, 'Voice channel not found, skipping restore');
                await deletePlayerState(state.guildId);
                continue;
            }

            // Create a new player
            const player = await client.music.createPlayer({
                guildId: state.guildId,
                voiceId: state.voiceChannelId,
                textId: state.textChannelId,
                deaf: true,
            });

            // Set volume and loop mode
            await player.setVolume(state.volume);
            player.setLoop(state.loop);

            // Restore current track and queue
            if (state.currentTrack) {
                const searchResult = await client.music.search(state.currentTrack.uri, { requester: client.user });
                const track = searchResult.tracks[0];
                if (track) {
                    player.queue.add(track);
                }
            }

            // Restore queue
            for (const queuedTrack of state.queue) {
                const searchResult = await client.music.search(queuedTrack.uri, { requester: client.user });
                const track = searchResult.tracks[0];
                if (track) {
                    player.queue.add(track);
                }
            }

            // Start playback
            if (!player.playing && player.queue.length > 0) {
                await player.play();

                // Seek to saved position if possible
                if (state.currentTrack && state.currentTrack.position > 0) {
                    // Add a small delay to ensure track is playing before seeking
                    setTimeout(async () => {
                        try {
                            // Calculate adjusted position accounting for time since save
                            const timeSinceSave = Date.now() - state.updatedAt;
                            const adjustedPosition = state.currentTrack!.position + timeSinceSave;

                            // Only seek if not past the end of the track
                            if (adjustedPosition < state.currentTrack!.duration) {
                                await player.seek(adjustedPosition);
                                logger.debug({ guildId: state.guildId, position: adjustedPosition }, 'Seeked to saved position');
                            }
                        } catch (seekError) {
                            logger.warn({ guildId: state.guildId, error: seekError }, 'Failed to seek to saved position');
                        }
                    }, 1500);
                }
            }

            // Start auto-saving for restored player
            startAutoSave(player);

            // Notify the text channel
            const textChannel = client.channels.cache.get(state.textChannelId);
            if (textChannel?.isTextBased() && 'send' in textChannel) {
                textChannel.send('🔄 Music session restored after bot failover. Resuming playback...');
            }

            restored++;
            logger.info({ guildId: state.guildId }, 'Restored player state');

        } catch (error) {
            logger.error({ guildId: state.guildId, error }, 'Failed to restore player state');
            await deletePlayerState(state.guildId);
        }
    }

    return restored;
}
