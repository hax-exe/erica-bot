import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/Command.js';
import { validateVoiceChannel } from '../../utils/voiceChannel.js';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('skip')
        .setDescription('Skip the current song'),
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
                content: '❌ Nothing to skip.',
                ephemeral: true,
            });
            return;
        }

        const currentTrack = validation.player.queue.current;
        await validation.player.skip();

        await interaction.reply(`⏭️ Skipped **${currentTrack.title}**`);
    },
});

