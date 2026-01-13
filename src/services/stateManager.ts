import type { KazagumoPlayer } from 'kazagumo';
import { getRedisClient } from './redis.js';
import { gameManager, type AnyGameSession } from './gameManager.js';
import type { ExtendedClient } from '../structures/Client.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('state-manager');

// Redis key prefixes
const MUSIC_STATE_KEY = (guildId: string) => `restart:music:${guildId}`;
const GAMES_STATE_KEY = 'restart:games';
const STATE_TTL = 300; // 5 minutes
const CHECKPOINT_INTERVAL = 30000; // Save state every 30 seconds

// Checkpoint interval reference
let checkpointInterval: NodeJS.Timeout | null = null;
let clientRef: ExtendedClient | null = null;

// Serializable music player state
interface MusicPlayerState {
    guildId: string;
    voiceChannelId: string;
    textChannelId: string;
    currentTrack: {
        uri: string;
        title: string;
        author: string;
        position: number;
    } | null;
    queue: Array<{ uri: string; title: string; author: string }>;
    volume: number;
    loop: string | null;
    autoplay: boolean;
}

/**
 * Save all active music players to Redis before shutdown
 */
export async function saveMusicState(
    players: Map<string, KazagumoPlayer>
): Promise<void> {
    if (players.size === 0) {
        logger.debug('No active music players to save');
        return;
    }

    const redis = getRedisClient();
    const pipeline = redis.pipeline();

    for (const [guildId, player] of players) {
        const currentTrack = player.queue.current;

        const state: MusicPlayerState = {
            guildId,
            voiceChannelId: player.voiceId || '',
            textChannelId: player.textId || '',
            currentTrack: currentTrack ? {
                uri: currentTrack.uri || '',
                title: currentTrack.title || 'Unknown',
                author: currentTrack.author || 'Unknown',
                position: player.position || 0,
            } : null,
            queue: player.queue.map(track => ({
                uri: track.uri || '',
                title: track.title || 'Unknown',
                author: track.author || 'Unknown',
            })),
            volume: player.volume,
            loop: player.loop as string | null,
            autoplay: (player.data.get('autoplay') as boolean) || false,
        };

        pipeline.setex(MUSIC_STATE_KEY(guildId), STATE_TTL, JSON.stringify(state));
    }

    await pipeline.exec();
    logger.info({ count: players.size }, 'Saved music player states');
}

/**
 * Load saved music states from Redis
 */
async function loadMusicStates(): Promise<MusicPlayerState[]> {
    const redis = getRedisClient();
    const keys = await redis.keys('restart:music:*');

    if (keys.length === 0) return [];

    const values = await redis.mget(keys);
    const states: MusicPlayerState[] = [];

    for (const value of values) {
        if (value) {
            try {
                states.push(JSON.parse(value));
            } catch {
                // Skip invalid JSON
            }
        }
    }

    return states;
}

/**
 * Wait for Lavalink to be connected
 */
async function waitForLavalink(client: ExtendedClient, timeoutMs: number): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
        // Check if any Lavalink node is connected
        const nodes = client.music.shoukaku.nodes;
        for (const node of nodes.values()) {
            if (node.state === 1) { // 1 = CONNECTED
                return true;
            }
        }

        // Wait 500ms before checking again
        await new Promise(r => setTimeout(r, 500));
    }

    return false;
}

/**
 * Restore music players from saved state
 */
export async function restoreMusicPlayers(client: ExtendedClient): Promise<void> {
    const states = await loadMusicStates();

    if (states.length === 0) {
        logger.debug('No music states to restore');
        return;
    }

    // Wait for Lavalink to be connected (up to 10 seconds)
    const lavalinkReady = await waitForLavalink(client, 10000);
    if (!lavalinkReady) {
        logger.warn('Lavalink not ready, skipping music restoration');
        await clearMusicStates();
        return;
    }

    logger.info({ count: states.length }, 'Restoring music players');

    for (const state of states) {
        try {
            // Skip if no voice channel
            if (!state.voiceChannelId || !state.textChannelId) continue;

            // Verify the voice channel still exists and we can join
            const voiceChannel = client.channels.cache.get(state.voiceChannelId);
            if (!voiceChannel?.isVoiceBased()) {
                logger.debug({ guildId: state.guildId }, 'Voice channel not found, skipping restore');
                continue;
            }

            // Create player and join voice channel
            const player = await client.music.createPlayer({
                guildId: state.guildId,
                voiceId: state.voiceChannelId,
                textId: state.textChannelId,
                deaf: true,
            });

            // Restore settings
            player.setVolume(state.volume);
            if (state.loop) {
                player.setLoop(state.loop as 'none' | 'track' | 'queue');
            }
            player.data.set('autoplay', state.autoplay);

            // Queue tracks (current track first, then queue)
            const tracksToQueue: Array<{ uri: string; title: string; author: string }> = [];
            if (state.currentTrack) {
                tracksToQueue.push(state.currentTrack);
            }
            tracksToQueue.push(...state.queue);

            for (const trackInfo of tracksToQueue) {
                if (!trackInfo.uri) continue;

                const result = await client.music.search(trackInfo.uri, { requester: null });
                const track = result.tracks[0];
                if (track) {
                    player.queue.add(track);
                }
            }

            // Start playback if we have tracks
            if (player.queue.length > 0 || player.queue.current) {
                const savedPosition = state.currentTrack?.position || 0;

                // Start playback (initially paused if we need to seek)
                await player.play();

                if (savedPosition > 0) {
                    // Pause immediately, seek, then resume
                    player.pause(true);

                    // Wait a moment for player to initialize
                    await new Promise(r => setTimeout(r, 500));

                    // Seek to saved position
                    player.seek(savedPosition);

                    // Wait for seek to complete
                    await new Promise(r => setTimeout(r, 300));

                    // Resume playback
                    player.pause(false);
                }
            }

            // Notify the channel
            const textChannel = client.channels.cache.get(state.textChannelId);
            if (textChannel?.isTextBased() && 'send' in textChannel) {
                textChannel.send('✅ **Back online!** Resuming music from where we left off.');
            }

            logger.info({ guildId: state.guildId }, 'Restored music player');
        } catch (error) {
            logger.error({ error, guildId: state.guildId }, 'Failed to restore music player');
        }
    }

    // Clear saved states after attempting restore
    await clearMusicStates();
}

/**
 * Clear saved music states
 */
async function clearMusicStates(): Promise<void> {
    const redis = getRedisClient();
    const keys = await redis.keys('restart:music:*');

    if (keys.length > 0) {
        await redis.del(...keys);
        logger.debug({ count: keys.length }, 'Cleared music states');
    }
}

// Serializable game state (dates as ISO strings)
interface SerializedGameSession {
    id: string;
    type: string;
    players: [string, string];
    playerSymbols: { [playerId: string]: string };
    currentTurn?: string;
    board?: string[][];
    choices?: { [playerId: string]: string | null };
    channelId: string;
    messageId: string;
    status: 'pending' | 'active' | 'finished';
    winner: string | null;
    createdAt: string;
    expiresAt: string;
}

/**
 * Save all active games to Redis before shutdown
 */
export async function saveGameState(): Promise<void> {
    const games = gameManager.getAllGames();

    if (games.size === 0) {
        logger.debug('No active games to save');
        return;
    }

    // Only save active/pending games
    const activeGames: SerializedGameSession[] = [];
    for (const game of games.values()) {
        if (game.status === 'finished') continue;

        const serialized: SerializedGameSession = {
            id: game.id,
            type: game.type,
            players: game.players,
            playerSymbols: game.playerSymbols,
            channelId: game.channelId,
            messageId: game.messageId,
            status: game.status,
            winner: game.winner,
            createdAt: game.createdAt.toISOString(),
            expiresAt: game.expiresAt.toISOString(),
        };

        // Add type-specific fields
        if ('board' in game) {
            serialized.board = game.board;
            serialized.currentTurn = game.currentTurn;
        }
        if ('choices' in game) {
            serialized.choices = game.choices;
        }

        activeGames.push(serialized);
    }

    if (activeGames.length === 0) {
        logger.debug('No active games to save');
        return;
    }

    const redis = getRedisClient();
    await redis.setex(GAMES_STATE_KEY, STATE_TTL, JSON.stringify(activeGames));
    logger.info({ count: activeGames.length }, 'Saved game states');
}

/**
 * Restore games from saved state
 */
export async function restoreGameState(): Promise<void> {
    const redis = getRedisClient();
    const data = await redis.get(GAMES_STATE_KEY);

    if (!data) {
        logger.debug('No game states to restore');
        return;
    }

    try {
        const serializedGames: SerializedGameSession[] = JSON.parse(data);

        // Convert back to game sessions
        const games: AnyGameSession[] = serializedGames.map(sg => {
            const base = {
                id: sg.id,
                type: sg.type as AnyGameSession['type'],
                players: sg.players,
                playerSymbols: sg.playerSymbols,
                channelId: sg.channelId,
                messageId: sg.messageId,
                status: sg.status,
                winner: sg.winner,
                createdAt: new Date(sg.createdAt),
                // Extend expiration from now
                expiresAt: new Date(Date.now() + 5 * 60 * 1000),
            };

            if (sg.type === 'rps') {
                return {
                    ...base,
                    type: 'rps' as const,
                    choices: (sg.choices || {}) as { [playerId: string]: 'rock' | 'paper' | 'scissors' | null },
                };
            }

            return {
                ...base,
                board: sg.board || [],
                currentTurn: sg.currentTurn || sg.players[0],
            };
        });

        gameManager.restoreGames(games);
        logger.info({ count: games.length }, 'Restored game states');

        // Clear saved state
        await redis.del(GAMES_STATE_KEY);
    } catch (error) {
        logger.error({ error }, 'Failed to restore game states');
    }
}

/**
 * Notify active channels before shutdown
 */
export async function notifyShutdown(client: ExtendedClient): Promise<void> {
    const players = client.music.players;

    for (const player of players.values()) {
        const channelId = player.textId;
        if (!channelId) continue;

        const channel = client.channels.cache.get(channelId);
        if (channel?.isTextBased() && 'send' in channel) {
            try {
                await channel.send('🔄 **Restarting for an update...** Music will resume shortly!');
            } catch {
                // Ignore send errors during shutdown
            }
        }
    }
}

/**
 * Start periodic state checkpointing for crash recovery
 * Saves music and game state every 30 seconds while active
 */
export function startStateCheckpoint(client: ExtendedClient): void {
    // Store client reference for checkpoint saves
    clientRef = client;

    // Clear any existing interval
    if (checkpointInterval) {
        clearInterval(checkpointInterval);
    }

    checkpointInterval = setInterval(async () => {
        if (!clientRef) return;

        // Only save if there are active players
        if (clientRef.music.players.size > 0) {
            try {
                await saveMusicState(clientRef.music.players);
                logger.debug('Checkpoint: saved music state');
            } catch (error) {
                logger.error({ error }, 'Checkpoint: failed to save music state');
            }
        }

        // Save game state if there are active games
        const games = gameManager.getAllGames();
        if (games.size > 0) {
            try {
                await saveGameState();
                logger.debug('Checkpoint: saved game state');
            } catch (error) {
                logger.error({ error }, 'Checkpoint: failed to save game state');
            }
        }
    }, CHECKPOINT_INTERVAL);

    logger.info('State checkpointing started (30s interval)');
}

/**
 * Stop periodic state checkpointing
 */
export function stopStateCheckpoint(): void {
    if (checkpointInterval) {
        clearInterval(checkpointInterval);
        checkpointInterval = null;
    }
    clientRef = null;
    logger.debug('State checkpointing stopped');
}
