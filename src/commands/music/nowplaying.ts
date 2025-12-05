import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { Command } from '../../types/Command.js';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('nowplaying')
        .setDescription('Show the currently playing song'),
    category: 'music',
    cooldown: 3,
    guildOnly: true,
    requiredModule: 'music',

    async execute(interaction, client) {
        const player = client.music.players.get(interaction.guildId!);

        if (!player || !player.queue.current) {
            await interaction.reply({
                content: '❌ No music is currently playing.',
                ephemeral: true,
            });
            return;
        }

        const track = player.queue.current;
        const position = player.shoukaku.position;
        const duration = track.length || 0;

        // Create progress bar
        const progressBar = createProgressBar(position, duration);
        const positionStr = formatDuration(position);
        const durationStr = formatDuration(duration);

        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('🎵 Now Playing')
            .setDescription(`[${track.title}](${track.uri})`)
            .addFields(
                { name: 'Author', value: track.author || 'Unknown', inline: true },
                { name: 'Requested By', value: `<@${(track.requester as any)?.id || 'Unknown'}>`, inline: true },
                { name: 'Volume', value: `${player.volume}%`, inline: true },
                { name: 'Progress', value: `${progressBar}\n\`${positionStr} / ${durationStr}\`` },
            )
            .setThumbnail(track.thumbnail || null)
            .setTimestamp();

        if (player.loop) {
            embed.addFields({ name: 'Loop', value: player.loop === 'track' ? '🔂 Track' : '🔁 Queue', inline: true });
        }

        await interaction.reply({ embeds: [embed] });
    },
});

function createProgressBar(current: number, total: number, length = 15): string {
    const progress = Math.round((current / total) * length);
    const empty = length - progress;

    return '▬'.repeat(Math.max(0, progress)) + '🔘' + '▬'.repeat(Math.max(0, empty - 1));
}

function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
        return `${hours}:${(minutes % 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
    }
    return `${minutes}:${(seconds % 60).toString().padStart(2, '0')}`;
}
