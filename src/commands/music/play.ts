import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
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

        await interaction.deferReply();

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

            // Search for track - use SoundCloud search if not a URL
            // YouTube is disabled due to authentication requirements
            const isUrl = query.startsWith('http://') || query.startsWith('https://');
            const searchQuery = isUrl ? query : `scsearch:${query}`;

            const result = await client.music.search(searchQuery, {
                requester: interaction.user,
            });

            if (!result.tracks.length) {
                await interaction.editReply('❌ No results found. Try a SoundCloud URL or different search terms.');
                return;
            }

            if (result.type === 'PLAYLIST') {
                // Add all tracks from playlist
                for (const track of result.tracks) {
                    player.queue.add(track);
                }

                const embed = new EmbedBuilder()
                    .setColor(0x5865f2)
                    .setTitle('📋 Playlist Added')
                    .setDescription(`Added **${result.tracks.length}** tracks from **${result.playlistName}**`)
                    .setFooter({ text: `Requested by ${interaction.user.tag}` });

                await interaction.editReply({ embeds: [embed] });
            } else {
                // Add single track
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
            }

            // Start playing if not already
            if (!player.playing && !player.paused) {
                await player.play();
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
