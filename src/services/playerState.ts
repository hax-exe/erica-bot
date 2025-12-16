import { getRedisClient, REDIS_KEYS } from './redis.js';
import { createLogger } from '../utils/logger.js';
import type { KazagumoPlayer } from 'kazagumo';
import type { ExtendedClient } from '../structures/Client.js';

const logger = createLogger('player-state');

const PLAYER_STATE_TTL = 5 * 60 * 1000;
const SAVE_INTERVAL = 5000;

export interface PlayerState {
    guildId: string;
    voiceChannelId: string;
    textChannelId: string;
    currentTrack: {
        uri: string;
        title: string;
        author: string;
        position: number;
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

const saveTimers = new Map<string, NodeJS.Timeout>();

export async function savePlayerState(player: KazagumoPlayer): Promise<void> {
    const redis = getRedisClient();
    const current = player.queue.current;

    const state: PlayerState = {
        guildId: player.guildId,
        voiceChannelId: player.voiceId || '',
        textChannelId: player.textId || '',
        currentTrack: current ? {
            uri: current.uri || '',
            title: current.title || 'Unknown',
            author: current.author || 'Unknown',
            position: player.position || 0,
            duration: current.length || 0,
        } : null,
        queue: player.queue.map(t => ({
            uri: t.uri || '',
            title: t.title || 'Unknown',
            author: t.author || 'Unknown',
            duration: t.length || 0,
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

export async function deletePlayerState(guildId: string): Promise<void> {
    const redis = getRedisClient();
    await redis.del(REDIS_KEYS.PLAYER_STATE(guildId));
    logger.debug({ guildId }, 'Player state deleted');
}

export function startAutoSave(player: KazagumoPlayer): void {
    stopAutoSave(player.guildId);

    const timer = setInterval(async () => {
        if (player.playing || player.paused) {
            await savePlayerState(player);
        }
    }, SAVE_INTERVAL);

    saveTimers.set(player.guildId, timer);
    logger.debug({ guildId: player.guildId }, 'Started auto-save for player');
}

export function stopAutoSave(guildId: string): void {
    const timer = saveTimers.get(guildId);
    if (timer) {
        clearInterval(timer);
        saveTimers.delete(guildId);
        logger.debug({ guildId }, 'Stopped auto-save for player');
    }
}

export function stopAllAutoSaves(): void {
    for (const [, timer] of saveTimers) {
        clearInterval(timer);
    }
    saveTimers.clear();
    logger.debug('Stopped all auto-saves');
}

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
            const guild = client.guilds.cache.get(state.guildId);
            if (!guild) {
                logger.warn({ guildId: state.guildId }, 'Guild not found, skipping restore');
                await deletePlayerState(state.guildId);
                continue;
            }

            const vc = guild.channels.cache.get(state.voiceChannelId);
            if (!vc?.isVoiceBased()) {
                logger.warn({ guildId: state.guildId }, 'Voice channel not found, skipping restore');
                await deletePlayerState(state.guildId);
                continue;
            }

            logger.info({ guildId: state.guildId, voiceId: state.voiceChannelId }, 'Creating player for restore');
            const player = await client.music.createPlayer({
                guildId: state.guildId,
                voiceId: state.voiceChannelId,
                textId: state.textChannelId,
                deaf: true,
            });

            await player.setVolume(state.volume);
            player.setLoop(state.loop);

            let firstTrack = null;
            if (state.currentTrack) {
                logger.debug({ guildId: state.guildId, uri: state.currentTrack.uri }, 'Searching for current track');
                const result = await client.music.search(state.currentTrack.uri, { requester: client.user });
                const track = result.tracks[0];
                if (track) {
                    firstTrack = track;
                    logger.debug({ guildId: state.guildId, title: track.title }, 'Found current track');
                } else {
                    logger.warn({ guildId: state.guildId, uri: state.currentTrack.uri }, 'Could not find current track');
                }
            }

            const queueTracks = [];
            for (const queued of state.queue) {
                const result = await client.music.search(queued.uri, { requester: client.user });
                const track = result.tracks[0];
                if (track) {
                    queueTracks.push(track);
                }
            }

            logger.info({
                guildId: state.guildId,
                hasFirstTrack: !!firstTrack,
                queueSize: queueTracks.length
            }, 'Tracks loaded for restore');

            if (firstTrack) {
                for (const track of queueTracks) {
                    player.queue.add(track);
                }

                logger.info({ guildId: state.guildId, track: firstTrack.title }, 'Starting playback');
                await player.play(firstTrack);

                if (state.currentTrack && state.currentTrack.position > 0) {
                    setTimeout(async () => {
                        try {
                            const elapsed = Date.now() - state.updatedAt;
                            const pos = Math.min(
                                state.currentTrack!.position + elapsed,
                                state.currentTrack!.duration - 5000
                            );

                            if (pos > 0 && pos < state.currentTrack!.duration) {
                                await player.seek(pos);
                                logger.info({ guildId: state.guildId, position: pos }, 'Seeked to saved position');
                            }
                        } catch (err) {
                            logger.warn({ guildId: state.guildId, error: err }, 'Failed to seek to saved position');
                        }
                    }, 2000);
                }
            } else if (queueTracks.length > 0) {
                for (const track of queueTracks) {
                    player.queue.add(track);
                }
                await player.play();
                logger.info({ guildId: state.guildId }, 'Playing from restored queue');
            } else {
                logger.warn({ guildId: state.guildId }, 'No tracks to restore, destroying player');
                player.destroy();
                await deletePlayerState(state.guildId);
                continue;
            }

            startAutoSave(player);

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
