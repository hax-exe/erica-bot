import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/Command.js';
import { validateVoiceChannel } from '../../utils/voiceChannel.js';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('seek')
        .setDescription('Seek to a specific position in the current song')
        .addStringOption((option) =>
            option
                .setName('position')
                .setDescription('Position to seek to (e.g., 1:30, 2:45:30)')
                .setRequired(true)
        ),
    category: 'music',
    cooldown: 3,
    guildOnly: true,
    requiredModule: 'music',

    async execute(interaction, client) {
        const positionStr = interaction.options.getString('position', true);
        const player = client.music.players.get(interaction.guildId!);
        const validation = validateVoiceChannel(interaction, player);

        if (!validation.valid) {
            await interaction.reply({ content: validation.message, ephemeral: true });
            return;
        }

        if (!validation.player.queue.current) {
            await interaction.reply({
                content: '❌ No music is currently playing.',
                ephemeral: true,
            });
            return;
        }

        const position = parseTime(positionStr);
        if (position === null) {
            await interaction.reply({
                content: '❌ Invalid time format. Use formats like: 1:30, 2:45, or 1:30:00',
                ephemeral: true,
            });
            return;
        }

        const duration = validation.player.queue.current.length || 0;
        if (position > duration) {
            await interaction.reply({
                content: '❌ Cannot seek beyond the song duration.',
                ephemeral: true,
            });
            return;
        }

        await validation.player.shoukaku.seekTo(position);

        await interaction.reply(`⏩ Seeked to \`${positionStr}\``);
    },
});

function parseTime(time: string): number | null {
    const parts = time.split(':').map(Number);

    if (parts.some(isNaN)) return null;

    if (parts.length === 2) {
        // mm:ss
        const [minutes, seconds] = parts;
        return (minutes! * 60 + seconds!) * 1000;
    } else if (parts.length === 3) {
        // hh:mm:ss
        const [hours, minutes, seconds] = parts;
        return (hours! * 3600 + minutes! * 60 + seconds!) * 1000;
    }

    return null;
}
