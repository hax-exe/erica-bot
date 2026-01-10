import { Events, ButtonInteraction, StringSelectMenuInteraction, TextChannel } from 'discord.js';
import { Event } from '../types/Event.js';
import { createLogger } from '../utils/logger.js';
import { createNowPlayingMessage } from '../utils/musicPlayer.js';

const logger = createLogger('music-buttons');

/**
 * Helper to update the Now Playing message with current player state
 */
async function updatePlayerMessage(client: any, interaction: ButtonInteraction, player: any): Promise<void> {
    try {
        // Get the Now Playing message ID stored in player data
        const messageId = player.data.get('nowPlayingMessageId') as string | undefined;
        if (!messageId) return;

        const channel = client.channels.cache.get(player.textId) as TextChannel;
        if (!channel) return;

        const message = await channel.messages.fetch(messageId).catch(() => null);
        if (!message || !player.queue.current) return;

        // Retrieve stored suggestions to preserve the dropdown menu
        const suggestions = player.data.get('suggestions') as Array<{
            title: string;
            author: string;
            uri: string;
            source: 'spotify' | 'youtube' | 'soundcloud';
        }> | undefined;

        const { embed, components } = createNowPlayingMessage(player, player.queue.current, suggestions);
        await message.edit({ embeds: [embed], components: components as any });
    } catch {
        // Message may have been deleted or edited by another process
    }
}

export default new Event({
    name: Events.InteractionCreate,

    async execute(client, interaction) {
        // Handle button interactions
        if (interaction.isButton()) {
            await handleButtonInteraction(client, interaction);
            return;
        }

        // Handle select menu interactions
        if (interaction.isStringSelectMenu()) {
            await handleSelectMenuInteraction(client, interaction);
            return;
        }
    },
});

async function handleButtonInteraction(client: any, interaction: ButtonInteraction) {
    const customId = interaction.customId;

    // Only handle music-related buttons
    if (!customId.startsWith('music_')) return;

    // Defer immediately to avoid 3-second timeout
    await interaction.deferReply({ ephemeral: true });

    const player = client.music.players.get(interaction.guildId!);
    if (!player) {
        await interaction.editReply('❌ No music is currently playing.');
        return;
    }

    // Check if user is in the same voice channel
    const member = interaction.member as any;
    const userVoiceChannel = member?.voice?.channel?.id;
    const botVoiceChannel = player.voiceId;

    if (!userVoiceChannel || userVoiceChannel !== botVoiceChannel) {
        await interaction.editReply('❌ You must be in the same voice channel to use this.');
        return;
    }

    try {
        switch (customId) {
            case 'music_pause':
                await player.pause(true);
                await interaction.editReply('⏸️ Paused the music.');
                // Update the Now Playing message to show the Resume button
                await updatePlayerMessage(client, interaction, player);
                break;

            case 'music_resume':
                await player.pause(false);
                await interaction.editReply('▶️ Resumed the music.');
                // Update the Now Playing message to show the Pause button
                await updatePlayerMessage(client, interaction, player);
                break;

            case 'music_skip': {
                if (!player.queue.current) {
                    await interaction.editReply('❌ Nothing to skip.');
                    return;
                }
                const skippedTrack = player.queue.current;
                await player.skip();
                await interaction.editReply(`⏭️ Skipped **${skippedTrack.title}**`);
                break;
            }

            case 'music_loop': {
                // Cycle through loop modes: none -> track -> queue -> none
                const currentLoop = player.loop;
                let newLoop: 'none' | 'track' | 'queue';
                let loopMessage: string;

                if (!currentLoop || currentLoop === 'none') {
                    newLoop = 'track';
                    loopMessage = '🔂 Now looping the current track';
                } else if (currentLoop === 'track') {
                    newLoop = 'queue';
                    loopMessage = '🔁 Now looping the entire queue';
                } else {
                    newLoop = 'none';
                    loopMessage = '➡️ Loop disabled';
                }

                player.setLoop(newLoop);
                await interaction.editReply(loopMessage);
                // Update the Now Playing message to show the new loop state
                await updatePlayerMessage(client, interaction, player);
                break;
            }

            case 'music_shuffle':
                if (player.queue.length < 2) {
                    await interaction.editReply('❌ Need at least 2 tracks in the queue to shuffle.');
                    return;
                }
                player.queue.shuffle();
                await interaction.editReply('🔀 Shuffled the queue.');
                break;

            case 'music_autoplay': {
                // Toggle autoplay (stored in player data)
                const isAutoplay = player.data.get('autoplay') as boolean || false;
                player.data.set('autoplay', !isAutoplay);
                await interaction.editReply(`📻 Autoplay ${!isAutoplay ? 'enabled' : 'disabled'}.`);
                // Update the Now Playing message to show the new autoplay state
                await updatePlayerMessage(client, interaction, player);
                break;
            }

            case 'music_stop':
                player.destroy();
                await interaction.editReply('⏹️ Stopped the music and left the channel.');
                break;

            case 'music_like': {
                const currentTrack = player.queue.current;
                if (!currentTrack) {
                    await interaction.editReply('❌ No track is currently playing.');
                    return;
                }

                const trackUri = currentTrack.uri || `${currentTrack.title}-${currentTrack.author}`;

                try {
                    const { db } = await import('../db/index.js');
                    const { likedSongs } = await import('../db/schema/index.js');
                    const { eq, and } = await import('drizzle-orm');

                    // Check if track is already liked
                    const existing = await db.select()
                        .from(likedSongs)
                        .where(and(
                            eq(likedSongs.userId, interaction.user.id),
                            eq(likedSongs.trackUri, trackUri)
                        ))
                        .limit(1);

                    if (existing.length > 0) {
                        // Unlike - remove from database
                        await db.delete(likedSongs)
                            .where(and(
                                eq(likedSongs.userId, interaction.user.id),
                                eq(likedSongs.trackUri, trackUri)
                            ));
                        await interaction.editReply(`🤍 Removed **${currentTrack.title}** from your liked songs.`);
                    } else {
                        // Like - add to database
                        await db.insert(likedSongs).values({
                            userId: interaction.user.id,
                            trackUri: trackUri,
                            trackTitle: currentTrack.title.slice(0, 256),
                            trackAuthor: currentTrack.author?.slice(0, 256) || null,
                            thumbnail: currentTrack.thumbnail?.slice(0, 500) || null,
                            duration: currentTrack.length || null,
                        });
                        await interaction.editReply(`💜 Added **${currentTrack.title}** to your liked songs!`);
                    }
                } catch (error) {
                    logger.error({ error }, 'Failed to toggle like status');
                    await interaction.editReply('❌ Failed to update liked songs. Please try again.');
                }
                break;
            }

            default:
                await interaction.editReply('❓ Unknown action.');
        }
    } catch (error: any) {
        // Check if interaction expired
        if (error?.code === 10062) {
            logger.warn({ customId }, 'Button interaction expired');
            return;
        }
        logger.error({ error }, 'Error handling music button');
        try {
            await interaction.editReply('❌ An error occurred.');
        } catch {
            // Ignore
        }
    }
}

async function handleSelectMenuInteraction(client: any, interaction: StringSelectMenuInteraction) {
    const customId = interaction.customId;

    // Only handle music suggestions menu
    if (customId !== 'music_suggestions') return;

    // Defer immediately to avoid 3-second timeout
    await interaction.deferReply({ ephemeral: true });

    const player = client.music.players.get(interaction.guildId!);
    if (!player) {
        await interaction.editReply('❌ No music player active.');
        return;
    }

    // Check if user is in the same voice channel
    const member = interaction.member as any;
    const userVoiceChannel = member?.voice?.channel?.id;
    const botVoiceChannel = player.voiceId;

    if (!userVoiceChannel || userVoiceChannel !== botVoiceChannel) {
        await interaction.editReply('❌ You must be in the same voice channel to use this.');
        return;
    }

    try {
        const selectedValue = interaction.values[0];
        if (!selectedValue) return;

        const index = parseInt(selectedValue.replace('suggestion_', ''), 10);
        const suggestions = player.data.get('suggestions') as Array<{
            title: string;
            author: string;
            uri: string;
        }> | undefined;

        if (!suggestions || !suggestions[index]) {
            await interaction.editReply('❌ Could not find that suggestion.');
            return;
        }

        const suggestion = suggestions[index];

        // Search and add the track
        const result = await client.music.search(suggestion.uri, { requester: interaction.user });

        if (!result.tracks.length) {
            await interaction.editReply('❌ Could not find that track.');
            return;
        }

        const track = result.tracks[0]!;
        player.queue.add(track);

        await interaction.editReply(`✅ Added **${track.title}** to the queue.`);

        // If nothing is playing, start playing
        if (!player.playing && !player.paused) {
            await player.play();
        }
    } catch (error: any) {
        // Check if interaction expired
        if (error?.code === 10062) {
            logger.warn({ customId }, 'Select menu interaction expired');
            return;
        }
        logger.error({ error }, 'Error handling suggestion selection');
        try {
            await interaction.editReply('❌ An error occurred while adding the track.');
        } catch {
            // Ignore
        }
    }
}
