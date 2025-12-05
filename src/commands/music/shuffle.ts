import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/Command.js';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('shuffle')
        .setDescription('Shuffle the music queue'),
    category: 'music',
    cooldown: 3,
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

        if (player.queue.length < 2) {
            await interaction.reply({
                content: '❌ Not enough songs in the queue to shuffle.',
                ephemeral: true,
            });
            return;
        }

        player.queue.shuffle();

        await interaction.reply(`🔀 Shuffled **${player.queue.length}** songs in the queue.`);
    },
});
