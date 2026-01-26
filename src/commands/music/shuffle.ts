import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/Command.js';
import { validateVoiceChannel } from '../../utils/voiceChannel.js';

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
        const validation = validateVoiceChannel(interaction, player);

        if (!validation.valid) {
            await interaction.reply({ content: validation.message, ephemeral: true });
            return;
        }

        if (validation.player.queue.length < 2) {
            await interaction.reply({
                content: '❌ Not enough songs in the queue to shuffle.',
                ephemeral: true,
            });
            return;
        }

        validation.player.queue.shuffle();

        await interaction.reply(`🔀 Shuffled **${validation.player.queue.length}** songs in the queue.`);
    },
});

