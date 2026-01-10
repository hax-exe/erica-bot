import {
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    TextChannel,
} from 'discord.js';
import type { KazagumoPlayer, KazagumoTrack } from 'kazagumo';

// Modern color palette
const COLORS = {
    primary: 0x7c3aed,      // Vibrant purple
    playing: 0x10b981,      // Emerald green (when playing)
    paused: 0xf59e0b,       // Amber (when paused)
    accent: 0x6366f1,       // Indigo accent
};

export function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
        return `${hours}:${(minutes % 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
    }
    return `${minutes}:${(seconds % 60).toString().padStart(2, '0')}`;
}

export function createProgressBar(current: number, total: number, length = 12): string {
    if (total === 0) return '░'.repeat(length);
    const progress = Math.round((current / total) * length);
    const filled = '▓'.repeat(Math.max(0, progress));
    const empty = '░'.repeat(Math.max(0, length - progress));
    return `${filled}${empty}`;
}

export function getLoopDisplay(loop: string | null): { emoji: string; text: string; active: boolean } {
    switch (loop) {
        case 'track':
            return { emoji: '🔂', text: 'Track', active: true };
        case 'queue':
            return { emoji: '🔁', text: 'Queue', active: true };
        default:
            return { emoji: '➡️', text: 'Off', active: false };
    }
}

export function createNowPlayingEmbed(
    player: KazagumoPlayer,
    track: KazagumoTrack
): EmbedBuilder {
    const duration = track.length || 0;
    const durationStr = formatDuration(duration);
    const loopInfo = getLoopDisplay(player.loop);
    const isPaused = player.paused;
    const autoplayEnabled = player.data.get('autoplay') as boolean || false;
    const queueSize = player.queue.length;

    // Requester info
    const requester = (track.requester as any);
    const requesterName = requester?.username || requester?.tag || 'Unknown';

    // Build description in Musico style
    const descriptionLines = [
        `**${track.author} - ${track.title}**`,
        ``,
        `⏱ ${durationStr}  ${loopInfo.active ? `${loopInfo.emoji} Loop: ${loopInfo.text}` : ''}`,
        `Requested by **${requesterName}**`,
        ``,
        `**Queue** - ${queueSize > 0 ? `${queueSize} track${queueSize !== 1 ? 's' : ''}` : 'empty'}`,
    ];

    // Add autoplay indicator if enabled
    if (autoplayEnabled) {
        descriptionLines.push(`📻 Autoplay enabled`);
    }

    const embed = new EmbedBuilder()
        .setColor(isPaused ? COLORS.paused : COLORS.primary)
        .setAuthor({ name: isPaused ? '⏸️ Paused' : 'NowPlaying' })
        .setDescription(descriptionLines.join('\n'))
        .setImage(track.thumbnail || null); // Large album art

    return embed;
}

/**
 * Creates an idle/empty state embed when no track is playing
 */
export function createIdleEmbed(): EmbedBuilder {
    return new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle('Nothing is Playing')
        .setDescription(
            '> No track is currently playing.\n' +
            '> Join a voice channel and add songs by name or URL.\n\n' +
            `Use \`/play\` to start playing music!`
        );
}

/**
 * Creates disabled buttons for idle state (nothing playing)
 */
export function createIdleButtons(): ActionRowBuilder<ButtonBuilder>[] {
    // Row 1: Pause, Skip, Like (all disabled)
    const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('music_pause')
            .setLabel('Pause')
            .setEmoji('⏸')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId('music_skip')
            .setLabel('Skip')
            .setEmoji('⏭️')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId('music_like')
            .setLabel('Like')
            .setEmoji('💜')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true)
    );

    // Row 2: Loop, Smart Shuffle (all disabled)
    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('music_loop')
            .setLabel('Loop')
            .setEmoji('🔁')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId('music_shuffle')
            .setLabel('Smart Shuffle')
            .setEmoji('✖️')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(true)
    );

    // Row 3: Autoplay (disabled), End Session (disabled)
    const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('music_autoplay')
            .setLabel('Autoplay')
            .setEmoji('♾️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId('music_stop')
            .setLabel('End Session')
            .setEmoji('⏹️')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(true)
    );

    return [row1, row2, row3];
}


export function createPlayerButtons(player: KazagumoPlayer): ActionRowBuilder<ButtonBuilder>[] {
    const isPaused = player.paused;
    const loopInfo = getLoopDisplay(player.loop);
    const autoplayEnabled = player.data.get('autoplay') as boolean || false;

    // Row 1: Pause (Secondary), Skip (Primary), Like (Secondary)
    const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(isPaused ? 'music_resume' : 'music_pause')
            .setLabel(isPaused ? 'Resume' : 'Pause')
            .setEmoji(isPaused ? '▶️' : '⏸')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('music_skip')
            .setLabel('Skip')
            .setEmoji('⏭️')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('music_like')
            .setLabel('Like')
            .setEmoji('💜')
            .setStyle(ButtonStyle.Secondary)
    );

    // Row 2: Loop (Primary when active), Smart Shuffle (Primary)
    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('music_loop')
            .setLabel('Loop')
            .setEmoji('🔁')
            .setStyle(loopInfo.active ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('music_shuffle')
            .setLabel('Smart Shuffle')
            .setEmoji('✖️')
            .setStyle(ButtonStyle.Primary)
    );

    // Row 3: Autoplay (Secondary when off), End Session (Danger)
    const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('music_autoplay')
            .setLabel('Autoplay')
            .setEmoji('♾️')
            .setStyle(autoplayEnabled ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('music_stop')
            .setLabel('End Session')
            .setEmoji('⏹️')
            .setStyle(ButtonStyle.Danger)
    );

    return [row1, row2, row3];
}

// dropdown with "you might like" tracks
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
        .setPlaceholder('Suggested tracks')
        .addOptions(options);

    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

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

export async function updateNowPlayingMessage(
    player: KazagumoPlayer,
    channel: TextChannel,
    messageId: string,
    suggestions?: Array<{ title: string; author: string; uri: string; source: 'spotify' | 'youtube' | 'soundcloud' }>
): Promise<void> {
    try {
        const message = await channel.messages.fetch(messageId);
        if (!message || !player.queue.current) return;

        const { embed, components } = createNowPlayingMessage(player, player.queue.current, suggestions);
        await message.edit({ embeds: [embed], components: components as any });
    } catch {
        // Message may have been deleted
    }
}

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
