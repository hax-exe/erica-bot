import {
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    Message,
    TextChannel,
} from 'discord.js';
import type { KazagumoPlayer, KazagumoTrack } from 'kazagumo';

/**
 * Format milliseconds to human-readable duration string
 */
export function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
        return `${hours}:${(minutes % 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
    }
    return `${minutes}:${(seconds % 60).toString().padStart(2, '0')}`;
}

/**
 * Create a visual progress bar for track playback
 */
export function createProgressBar(current: number, total: number, length = 15): string {
    if (total === 0) return '▬'.repeat(length);
    const progress = Math.round((current / total) * length);
    const empty = length - progress;
    return '▬'.repeat(Math.max(0, progress)) + '🔘' + '▬'.repeat(Math.max(0, empty - 1));
}

/**
 * Get the loop mode emoji and text
 */
export function getLoopDisplay(loop: string | null): { emoji: string; text: string } {
    switch (loop) {
        case 'track':
            return { emoji: '🔂', text: 'Track' };
        case 'queue':
            return { emoji: '🔁', text: 'Queue' };
        default:
            return { emoji: '➡️', text: 'Off' };
    }
}

/**
 * Create the Now Playing embed with all track information
 */
export function createNowPlayingEmbed(
    player: KazagumoPlayer,
    track: KazagumoTrack
): EmbedBuilder {
    const position = player.shoukaku.position;
    const duration = track.length || 0;
    const progressBar = createProgressBar(position, duration);
    const positionStr = formatDuration(position);
    const durationStr = formatDuration(duration);
    const loopInfo = getLoopDisplay(player.loop);

    const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setAuthor({ name: '🎵 Now Playing' })
        .setTitle(track.title)
        .setURL(track.uri || null)
        .setDescription(`${progressBar}\n\`${positionStr} / ${durationStr}\``)
        .addFields(
            { name: 'Duration', value: durationStr, inline: true },
            { name: 'Requested by', value: `<@${(track.requester as any)?.id || 'Unknown'}>`, inline: true },
            { name: 'Loop', value: `${loopInfo.emoji} ${loopInfo.text}`, inline: true }
        )
        .setThumbnail(track.thumbnail || null)
        .setTimestamp();

    if (player.queue.length > 0) {
        embed.setFooter({ text: `${player.queue.length} track(s) in queue` });
    }

    return embed;
}

/**
 * Create control buttons for the music player
 */
export function createPlayerButtons(player: KazagumoPlayer): ActionRowBuilder<ButtonBuilder>[] {
    const isPaused = player.paused;
    const loopInfo = getLoopDisplay(player.loop);

    // Row 1: Pause/Resume, Skip, Like
    const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(isPaused ? 'music_resume' : 'music_pause')
            .setLabel(isPaused ? 'Resume' : 'Pause')
            .setEmoji(isPaused ? '▶️' : '⏸️')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('music_skip')
            .setLabel('Skip')
            .setEmoji('⏭️')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('music_like')
            .setLabel('Like')
            .setEmoji('❤️')
            .setStyle(ButtonStyle.Secondary)
    );

    // Row 2: Loop, Smart Shuffle
    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('music_loop')
            .setLabel(`Loop: ${loopInfo.text}`)
            .setEmoji(loopInfo.emoji)
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('music_shuffle')
            .setLabel('Smart Shuffle')
            .setEmoji('🔀')
            .setStyle(ButtonStyle.Secondary)
    );

    // Row 3: Autoplay, End Session
    const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('music_autoplay')
            .setLabel('Autoplay')
            .setEmoji('🔊')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('music_stop')
            .setLabel('End Session')
            .setEmoji('⏹️')
            .setStyle(ButtonStyle.Danger)
    );

    return [row1, row2, row3];
}

/**
 * Create the "Suggested by AI" select menu
 */
export function createSuggestionsMenu(
    suggestions: Array<{ title: string; author: string; uri: string; source: 'spotify' | 'youtube' | 'soundcloud' }>
): ActionRowBuilder<StringSelectMenuBuilder> | null {
    if (!suggestions.length) return null;

    const sourceEmojis = {
        spotify: '🟢',
        youtube: '🔴',
        soundcloud: '🟠',
    };

    const options = suggestions.slice(0, 5).map((track, index) =>
        new StringSelectMenuOptionBuilder()
            .setLabel(`${track.author} - ${track.title}`.slice(0, 100))
            .setDescription(track.title.slice(0, 100))
            .setValue(`suggestion_${index}`)
            .setEmoji(sourceEmojis[track.source] || '🎵')
    );

    const menu = new StringSelectMenuBuilder()
        .setCustomId('music_suggestions')
        .setPlaceholder('Suggested by AI')
        .addOptions(options);

    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

/**
 * Create the complete Now Playing message with embed and components
 */
export function createNowPlayingMessage(
    player: KazagumoPlayer,
    track: KazagumoTrack,
    suggestions?: Array<{ title: string; author: string; uri: string; source: 'spotify' | 'youtube' | 'soundcloud' }>
): { embed: EmbedBuilder; components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] } {
    const embed = createNowPlayingEmbed(player, track);
    const buttonRows = createPlayerButtons(player);
    const suggestionsMenu = suggestions ? createSuggestionsMenu(suggestions) : null;

    const components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [...buttonRows];
    if (suggestionsMenu) {
        components.push(suggestionsMenu as ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>);
    }

    return { embed, components };
}

/**
 * Update an existing Now Playing message
 */
export async function updateNowPlayingMessage(
    player: KazagumoPlayer,
    channel: TextChannel,
    messageId: string
): Promise<void> {
    try {
        const message = await channel.messages.fetch(messageId);
        if (!message || !player.queue.current) return;

        const { embed, components } = createNowPlayingMessage(player, player.queue.current);
        await message.edit({ embeds: [embed], components: components as any });
    } catch {
        // Message may have been deleted
    }
}

/**
 * Delete the Now Playing message when session ends
 */
export async function deleteNowPlayingMessage(
    channel: TextChannel,
    messageId: string
): Promise<void> {
    try {
        const message = await channel.messages.fetch(messageId);
        if (message?.deletable) {
            await message.delete();
        }
    } catch {
        // Message may already be deleted
    }
}
