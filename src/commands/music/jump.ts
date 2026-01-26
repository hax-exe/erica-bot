import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/Command.js';
import { validateVoiceChannel } from '../../utils/voiceChannel.js';

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

        if (validation.player.queue.length === 0) {
            await interaction.reply({
                content: '❌ The queue is empty.',
                ephemeral: true,
            });
            return;
        }

        if (position > validation.player.queue.length) {
            await interaction.reply({
                content: `❌ Invalid position. The queue only has ${validation.player.queue.length} track(s).`,
                ephemeral: true,
            });
            return;
        }

        // Remove all tracks before the target position
        const tracksToRemove = position - 1;
        for (let i = 0; i < tracksToRemove; i++) {
            validation.player.queue.shift();
        }

        // Get the track we're jumping to
        const targetTrack = validation.player.queue[0];

        // Skip to the target track
        await validation.player.skip();

        await interaction.reply(`⏭️ Jumped to position ${position}: **${targetTrack?.title || 'Unknown'}**`);
    },
});

