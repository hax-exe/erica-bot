import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { Command } from '../../types/Command.js';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('queue')
        .setDescription('View the current music queue')
        .addIntegerOption((option) =>
            option
                .setName('page')
                .setDescription('Page number to view')
                .setMinValue(1)
        ),
    category: 'music',
    cooldown: 5,
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

        const queue = player.queue;
        const current = queue.current!;
        const page = interaction.options.getInteger('page') || 1;
        const pageSize = 10;
        const totalPages = Math.ceil(queue.length / pageSize) || 1;

        if (page > totalPages) {
            await interaction.reply({
                content: `❌ Invalid page. Total pages: ${totalPages}`,
                ephemeral: true,
            });
            return;
        }

        const start = (page - 1) * pageSize;
        const tracks = queue.slice(start, start + pageSize);

        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('🎵 Music Queue')
            .setDescription(
                `**Now Playing:**\n[${current.title}](${current.uri}) • \`${formatDuration(current.length || 0)}\`\n\n` +
                (tracks.length > 0
                    ? tracks.map((track, i) =>
                        `**${start + i + 1}.** [${track.title}](${track.uri}) • \`${formatDuration(track.length || 0)}\``
                    ).join('\n')
                    : '*Queue is empty*')
            )
            .addFields(
                { name: 'Total Tracks', value: `${queue.length + 1}`, inline: true },
                { name: 'Total Duration', value: formatDuration(getTotalDuration(queue, current)), inline: true },
                { name: 'Loop', value: player.loop || 'Off', inline: true },
            )
            .setFooter({ text: `Page ${page}/${totalPages}` })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
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

function getTotalDuration(queue: any, current: any): number {
    let total = current?.length || 0;
    for (const track of queue) {
        total += track.length || 0;
    }
    return total;
}
