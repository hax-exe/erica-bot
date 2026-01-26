import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/Command.js';
import { validateVoiceChannel } from '../../utils/voiceChannel.js';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('remove')
        .setDescription('Remove a song from the queue')
        .addIntegerOption((option) =>
            option
                .setName('position')
                .setDescription('Position of the song to remove')
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
        const validation = validateVoiceChannel(interaction, player);

        if (!validation.valid) {
            await interaction.reply({ content: validation.message, ephemeral: true });
            return;
        }

        if (position > validation.player.queue.length) {
            await interaction.reply({
                content: `❌ Invalid position. Queue only has ${validation.player.queue.length} song(s).`,
                ephemeral: true,
            });
            return;
        }

        const removed = validation.player.queue.splice(position - 1, 1)[0];

        if (!removed) {
            await interaction.reply({
                content: '❌ Could not remove song.',
                ephemeral: true,
            });
            return;
        }

        await interaction.reply(`🗑️ Removed **${removed.title}** from the queue.`);
    },
});

