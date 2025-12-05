import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/Command.js';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('clearqueue')
        .setDescription('Clear all songs from the queue'),
    category: 'music',
    cooldown: 5,
    guildOnly: true,
    requiredModule: 'music',

    async execute(interaction, client) {
        const player = client.music.players.get(interaction.guildId!);

        if (!player) {
            await interaction.reply({
                content: '❌ No music is currently playing.',
                ephemeral: true,
            });
            return;
        }

        if (player.queue.length === 0) {
            await interaction.reply({
                content: '❌ The queue is already empty.',
                ephemeral: true,
            });
            return;
        }

        const count = player.queue.length;
        player.queue.clear();

        await interaction.reply(`🗑️ Cleared **${count}** song(s) from the queue.`);
    },
});
