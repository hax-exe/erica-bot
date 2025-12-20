import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { Command } from '../../types/Command.js';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('grab')
        .setDescription('Send the current track info to your DMs'),
    category: 'music',
    cooldown: 10,
    guildOnly: true,
    requiredModule: 'music',

    async execute(interaction, client) {
        // Defer immediately to avoid 3-second timeout
        await interaction.deferReply({ ephemeral: true });

        const player = client.music.players.get(interaction.guildId!);

        if (!player || !player.queue.current) {
            await interaction.editReply('❌ No music is currently playing.');
            return;
        }

        const track = player.queue.current;

        const formatDuration = (ms: number): string => {
            const seconds = Math.floor(ms / 1000);
            const minutes = Math.floor(seconds / 60);
            const hours = Math.floor(minutes / 60);

            if (hours > 0) {
                return `${hours}:${(minutes % 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
            }
            return `${minutes}:${(seconds % 60).toString().padStart(2, '0')}`;
        };

        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('🎵 Grabbed Track')
            .setDescription(`[${track.title}](${track.uri})`)
            .addFields(
                { name: 'Artist', value: track.author || 'Unknown', inline: true },
                { name: 'Duration', value: formatDuration(track.length || 0), inline: true },
                { name: 'Source', value: track.sourceName || 'Unknown', inline: true }
            )
            .setThumbnail(track.thumbnail || null)
            .setFooter({ text: `From: ${interaction.guild?.name || 'Unknown Server'}` })
            .setTimestamp();

        try {
            await interaction.user.send({ embeds: [embed] });
            await interaction.editReply('✅ Sent the track info to your DMs!');
        } catch {
            await interaction.editReply('❌ Could not send DM. Please make sure your DMs are open.');
        }
    },
});
