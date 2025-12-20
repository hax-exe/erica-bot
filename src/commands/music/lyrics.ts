import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { Command } from '../../types/Command.js';
import { getLyrics, splitLyricsForEmbed, isLyricsConfigured } from '../../utils/lyrics.js';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('lyrics')
        .setDescription('Show the lyrics of a song')
        .addStringOption((option) =>
            option
                .setName('query')
                .setDescription('Song to search for (leave empty for current track)')
                .setRequired(false)
        ),
    category: 'music',
    cooldown: 10,
    guildOnly: true,
    requiredModule: 'music',

    async execute(interaction, client) {
        if (!isLyricsConfigured()) {
            await interaction.reply({
                content: '❌ Lyrics feature is not configured. Please add `GENIUS_ACCESS_TOKEN` to your environment variables.',
                ephemeral: true,
            });
            return;
        }

        const query = interaction.options.getString('query');
        let searchTitle: string;
        let searchArtist: string | undefined;

        if (query) {
            // User provided a search query
            searchTitle = query;
        } else {
            // Use currently playing track
            const player = client.music.players.get(interaction.guildId!);

            if (!player || !player.queue.current) {
                await interaction.reply({
                    content: '❌ No music is currently playing. Please provide a song to search for.',
                    ephemeral: true,
                });
                return;
            }

            searchTitle = player.queue.current.title;
            searchArtist = player.queue.current.author;
        }

        await interaction.deferReply();

        try {
            const result = await getLyrics(searchTitle, searchArtist);

            if (!result) {
                await interaction.editReply('❌ Could not find lyrics for that song.');
                return;
            }

            const chunks = splitLyricsForEmbed(result.lyrics);

            // Send the first chunk with full embed
            const firstEmbed = new EmbedBuilder()
                .setColor(0x5865f2)
                .setTitle(`🎤 ${result.title}`)
                .setDescription(chunks[0] ?? '')
                .setURL(result.url)
                .setAuthor({ name: result.artist })
                .setFooter({
                    text: chunks.length > 1
                        ? `Page 1/${chunks.length} • Powered by Genius`
                        : 'Powered by Genius',
                });

            if (result.thumbnail) {
                firstEmbed.setThumbnail(result.thumbnail);
            }

            await interaction.editReply({ embeds: [firstEmbed] });

            // Send additional chunks as follow-up messages
            for (let i = 1; i < chunks.length; i++) {
                const chunkContent = chunks[i];
                if (!chunkContent) continue;

                const embed = new EmbedBuilder()
                    .setColor(0x5865f2)
                    .setDescription(chunkContent)
                    .setFooter({ text: `Page ${i + 1}/${chunks.length}` });

                await interaction.followUp({ embeds: [embed] });
            }
        } catch (error) {
            console.error('Lyrics error:', error);
            await interaction.editReply('❌ An error occurred while fetching lyrics.');
        }
    },
});
