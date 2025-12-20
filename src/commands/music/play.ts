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
        const isUrl = query.startsWith('http://') || query.startsWith('https://');

        // Defer immediately to avoid 3-second timeout
        await interaction.deferReply({ flags: isUrl ? undefined : MessageFlags.Ephemeral });

        const member = interaction.member;
        // @ts-expect-error - Voice state exists on GuildMember
        const vc = member?.voice?.channel;

        if (!vc) {
            await interaction.editReply('❌ You must be in a voice channel to use this command.');
            return;
        }

        try {
            let player = client.music.players.get(interaction.guildId!);

            if (!player) {
                player = await client.music.createPlayer({
                    guildId: interaction.guildId!,
                    textId: interaction.channelId,
                    voiceId: vc.id,
                    volume: 50,
                    deaf: true,
                });
            }

            const opts = isUrl
                ? { requester: interaction.user }
                : { requester: interaction.user, engine: 'spsearch:' };

            const result = await client.music.search(query, opts);

            if (!result.tracks.length) {
                await interaction.editReply('❌ No results found. Try a direct URL (YouTube, Spotify, SoundCloud) or different search terms.');
                return;
            }

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

            const tracks = result.tracks.slice(0, 5);

            const list = tracks
                .map((t, i) => `**${i + 1}.** [${t.title}](${t.uri}) - ${t.author || 'Unknown'} (${formatDuration(t.length || 0)})`)
                .join('\n');

            const embed = new EmbedBuilder()
                .setColor(0x5865f2)
                .setTitle('🔍 Search Results')
                .setDescription(`${list}\n\n*Select a track or cancel. Expires in 30 seconds.*`)
                .setFooter({ text: `Requested by ${interaction.user.tag}` });

            const trackBtns = tracks.map((_, i) =>
                new ButtonBuilder()
                    .setCustomId(`track_select_${i}`)
                    .setLabel(`${i + 1}`)
                    .setStyle(ButtonStyle.Primary)
            );

            const cancelBtn = new ButtonBuilder()
                .setCustomId('track_select_cancel')
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary);

            const trackRow = new ActionRowBuilder<ButtonBuilder>().addComponents(...trackBtns);
            const cancelRow = new ActionRowBuilder<ButtonBuilder>().addComponents(cancelBtn);

            const response = await interaction.editReply({ embeds: [embed], components: [trackRow, cancelRow] });

            try {
                const btn = await response.awaitMessageComponent({
                    componentType: ComponentType.Button,
                    filter: (i) => i.user.id === interaction.user.id,
                    time: 30_000,
                });

                if (btn.customId === 'track_select_cancel') {
                    await interaction.deleteReply();
                    return;
                }

                const idx = parseInt(btn.customId.replace('track_select_', ''), 10);
                const selected = tracks[idx]!;

                player.queue.add(selected);
                await interaction.deleteReply();

                const confirmEmbed = new EmbedBuilder()
                    .setColor(0x5865f2)
                    .setTitle('🎵 Track Added')
                    .setDescription(`[${selected.title}](${selected.uri})`)
                    .addFields(
                        { name: 'Author', value: selected.author || 'Unknown', inline: true },
                        { name: 'Duration', value: formatDuration(selected.length || 0), inline: true },
                        { name: 'Position', value: `#${player.queue.length}`, inline: true },
                    )
                    .setThumbnail(selected.thumbnail || null)
                    .setFooter({ text: `Requested by ${interaction.user.tag}` });

                if (interaction.channel?.isTextBased() && 'send' in interaction.channel) {
                    await interaction.channel.send({ embeds: [confirmEmbed] });
                }

                if (!player.playing && !player.paused) {
                    await player.play();
                }
            } catch {
                await interaction.deleteReply().catch(() => { });
            }
        } catch (error) {
            console.error('Music play error:', error);
            await interaction.editReply('❌ An error occurred while playing the track.');
        }
    },
});

function formatDuration(ms: number): string {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);

    if (h > 0) {
        return `${h}:${(m % 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
    }
    return `${m}:${(s % 60).toString().padStart(2, '0')}`;
}
