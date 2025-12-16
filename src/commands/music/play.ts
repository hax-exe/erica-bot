import { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType, MessageFlags } from 'discord.js';
import { Command } from '../../types/Command.js';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play a song or add it to the queue')
        .addStringOption((option) =>
            option
                .setName('query')
                .setDescription('Song name or URL to play')
                .setRequired(true)
        ),
    category: 'music',
    cooldown: 3,
    guildOnly: true,
    requiredModule: 'music',

    async execute(interaction, client) {
        const query = interaction.options.getString('query', true);
        const member = interaction.member;

        // @ts-expect-error - Voice state exists on GuildMember
        const voiceChannel = member?.voice?.channel;

        if (!voiceChannel) {
            await interaction.reply({
                content: '❌ You must be in a voice channel to use this command.',
                ephemeral: true,
            });
            return;
        }

        const isUrl = query.startsWith('http://') || query.startsWith('https://');

        // Defer differently: ephemeral for search selection, public for URLs
        await interaction.deferReply({ flags: isUrl ? undefined : MessageFlags.Ephemeral });

        try {
            // Get or create player
            let player = client.music.players.get(interaction.guildId!);

            if (!player) {
                player = await client.music.createPlayer({
                    guildId: interaction.guildId!,
                    textId: interaction.channelId,
                    voiceId: voiceChannel.id,
                    volume: 50,
                });
            }

            // Search for track - use Spotify search via LavaSrc plugin
            const searchOptions = isUrl
                ? { requester: interaction.user }
                : { requester: interaction.user, engine: 'spsearch:' };

            const result = await client.music.search(query, searchOptions);

            if (!result.tracks.length) {
                await interaction.editReply('❌ No results found. Try a direct URL (YouTube, Spotify, SoundCloud) or different search terms.');
                return;
            }

            // Handle playlists - add all tracks directly
            if (result.type === 'PLAYLIST') {
                for (const track of result.tracks) {
                    player.queue.add(track);
                }

                const embed = new EmbedBuilder()
                    .setColor(0x5865f2)
                    .setTitle('📋 Playlist Added')
                    .setDescription(`Added **${result.tracks.length}** tracks from **${result.playlistName}**`)
                    .setFooter({ text: `Requested by ${interaction.user.tag}` });

                await interaction.editReply({ embeds: [embed] });

                if (!player.playing && !player.paused) {
                    await player.play();
                }
                return;
            }

            // Handle direct URLs - add directly without selection
            if (isUrl) {
                const track = result.tracks[0]!;
                player.queue.add(track);

                const embed = new EmbedBuilder()
                    .setColor(0x5865f2)
                    .setTitle('🎵 Track Added')
                    .setDescription(`[${track.title}](${track.uri})`)
                    .addFields(
                        { name: 'Author', value: track.author || 'Unknown', inline: true },
                        { name: 'Duration', value: formatDuration(track.length || 0), inline: true },
                        { name: 'Position', value: `#${player.queue.length}`, inline: true },
                    )
                    .setThumbnail(track.thumbnail || null)
                    .setFooter({ text: `Requested by ${interaction.user.tag}` });

                await interaction.editReply({ embeds: [embed] });

                if (!player.playing && !player.paused) {
                    await player.play();
                }
                return;
            }

            // Text query - show selection with buttons
            const tracks = result.tracks.slice(0, 5);

            const trackList = tracks
                .map((t, i) => `**${i + 1}.** [${t.title}](${t.uri}) - ${t.author || 'Unknown'} (${formatDuration(t.length || 0)})`)
                .join('\n');

            const embed = new EmbedBuilder()
                .setColor(0x5865f2)
                .setTitle('🔍 Search Results')
                .setDescription(`${trackList}\n\n*Select a track or cancel. Expires in 30 seconds.*`)
                .setFooter({ text: `Requested by ${interaction.user.tag}` });

            // Create selection buttons (max 5 per row, so split if needed)
            const trackButtons = tracks.map((_, i) =>
                new ButtonBuilder()
                    .setCustomId(`track_select_${i}`)
                    .setLabel(`${i + 1}`)
                    .setStyle(ButtonStyle.Primary)
            );

            const cancelButton = new ButtonBuilder()
                .setCustomId('track_select_cancel')
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary);

            // Track buttons row (up to 5)
            const trackRow = new ActionRowBuilder<ButtonBuilder>().addComponents(...trackButtons);
            // Cancel button on separate row
            const cancelRow = new ActionRowBuilder<ButtonBuilder>().addComponents(cancelButton);

            const response = await interaction.editReply({ embeds: [embed], components: [trackRow, cancelRow] });

            // Wait for button interaction
            try {
                const buttonInteraction = await response.awaitMessageComponent({
                    componentType: ComponentType.Button,
                    filter: (i) => i.user.id === interaction.user.id,
                    time: 30_000,
                });

                if (buttonInteraction.customId === 'track_select_cancel') {
                    await interaction.deleteReply();
                    return;
                }

                // Parse track index from button ID
                const trackIndex = parseInt(buttonInteraction.customId.replace('track_select_', ''), 10);
                const selectedTrack = tracks[trackIndex]!;

                player.queue.add(selectedTrack);

                // Update ephemeral with confirmation, send public message
                await interaction.deleteReply();

                const confirmEmbed = new EmbedBuilder()
                    .setColor(0x5865f2)
                    .setTitle('🎵 Track Added')
                    .setDescription(`[${selectedTrack.title}](${selectedTrack.uri})`)
                    .addFields(
                        { name: 'Author', value: selectedTrack.author || 'Unknown', inline: true },
                        { name: 'Duration', value: formatDuration(selectedTrack.length || 0), inline: true },
                        { name: 'Position', value: `#${player.queue.length}`, inline: true },
                    )
                    .setThumbnail(selectedTrack.thumbnail || null)
                    .setFooter({ text: `Requested by ${interaction.user.tag}` });

                if (interaction.channel?.isTextBased() && 'send' in interaction.channel) {
                    await interaction.channel.send({ embeds: [confirmEmbed] });
                }

                if (!player.playing && !player.paused) {
                    await player.play();
                }
            } catch {
                // Timeout - remove the message
                await interaction.deleteReply().catch(() => { });
            }
        } catch (error) {
            console.error('Music play error:', error);
            await interaction.editReply('❌ An error occurred while playing the track.');
        }
    },
});

function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
        return `${hours}:${(minutes % 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
    }
    return `${minutes}:${(seconds % 60).toString().padStart(2, '0')}`;
}
