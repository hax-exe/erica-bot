import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/Command.js';
import { validateVoiceChannel } from '../../utils/voiceChannel.js';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('resume')
        .setDescription('Resume the paused song'),
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

        if (!validation.player.queue.current) {
            await interaction.reply({
                content: '❌ No music is currently playing.',
                ephemeral: true,
            });
            return;
        }

        if (!validation.player.paused) {
            await interaction.reply({
                content: '❌ The music is not paused.',
                ephemeral: true,
            });
            return;
        }

        await validation.player.pause(false);
        await interaction.reply('▶️ Resumed the music.');
    },
});

