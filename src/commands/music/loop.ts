import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/Command.js';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('loop')
        .setDescription('Set the loop mode')
        .addStringOption((option) =>
            option
                .setName('mode')
                .setDescription('Loop mode')
                .setRequired(true)
                .addChoices(
                    { name: 'Off', value: 'none' },
                    { name: 'Track', value: 'track' },
                    { name: 'Queue', value: 'queue' },
                )
        ),
    category: 'music',
    cooldown: 3,
    guildOnly: true,
    requiredModule: 'music',

    async execute(interaction, client) {
        const mode = interaction.options.getString('mode', true) as 'none' | 'track' | 'queue';
        const player = client.music.players.get(interaction.guildId!);

        if (!player) {
            await interaction.reply({
                content: '❌ No music is currently playing.',
                ephemeral: true,
            });
            return;
        }

        player.setLoop(mode);

        const messages = {
            none: '➡️ Loop disabled',
            track: '🔂 Now looping the current track',
            queue: '🔁 Now looping the entire queue',
        };

        await interaction.reply(messages[mode]);
    },
});
