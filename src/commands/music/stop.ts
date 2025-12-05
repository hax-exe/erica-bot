import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/Command.js';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Stop the music and clear the queue'),
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

        player.destroy();
        await interaction.reply('⏹️ Stopped the music and cleared the queue.');
    },
});
