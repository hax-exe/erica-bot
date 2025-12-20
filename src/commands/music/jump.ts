import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/Command.js';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('jump')
        .setDescription('Jump to a specific track in the queue')
        .addIntegerOption((option) =>
            option
                .setName('position')
                .setDescription('Position in the queue to jump to (1 = first in queue)')
                .setRequired(true)
                .setMinValue(1)
        ),
    category: 'music',
    cooldown: 3,
    guildOnly: true,
    requiredModule: 'music',

    async execute(interaction, client) {
        const position = interaction.options.getInteger('position', true);
        const player = client.music.players.get(interaction.guildId!);

        if (!player || !player.queue.current) {
            await interaction.reply({
                content: '❌ No music is currently playing.',
                ephemeral: true,
            });
            return;
        }

        if (player.queue.length === 0) {
            await interaction.reply({
                content: '❌ The queue is empty.',
                ephemeral: true,
            });
            return;
        }

        if (position > player.queue.length) {
            await interaction.reply({
                content: `❌ Invalid position. The queue only has ${player.queue.length} track(s).`,
                ephemeral: true,
            });
            return;
        }

        // Remove all tracks before the target position
        const tracksToRemove = position - 1;
        for (let i = 0; i < tracksToRemove; i++) {
            player.queue.shift();
        }

        // Get the track we're jumping to
        const targetTrack = player.queue[0];

        // Skip to the target track
        await player.skip();

        await interaction.reply(`⏭️ Jumped to position ${position}: **${targetTrack?.title || 'Unknown'}**`);
    },
});
