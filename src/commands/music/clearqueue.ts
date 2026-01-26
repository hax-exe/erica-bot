import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/Command.js';
import { validateVoiceChannel } from '../../utils/voiceChannel.js';

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
        const validation = validateVoiceChannel(interaction, player);

        if (!validation.valid) {
            await interaction.reply({ content: validation.message, ephemeral: true });
            return;
        }

        if (validation.player.queue.length === 0) {
            await interaction.reply({
                content: '❌ The queue is already empty.',
                ephemeral: true,
            });
            return;
        }

        const count = validation.player.queue.length;
        validation.player.queue.clear();

        await interaction.reply(`🗑️ Cleared **${count}** song(s) from the queue.`);
    },
});

