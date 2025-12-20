import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/Command.js';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('rewind')
        .setDescription('Rewind the current track by a specified number of seconds')
        .addIntegerOption((option) =>
            option
                .setName('seconds')
                .setDescription('Number of seconds to rewind')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(300)
        ),
    category: 'music',
    cooldown: 3,
    guildOnly: true,
    requiredModule: 'music',

    async execute(interaction, client) {
        const seconds = interaction.options.getInteger('seconds', true);
        const player = client.music.players.get(interaction.guildId!);

        if (!player || !player.queue.current) {
            await interaction.reply({
                content: '❌ No music is currently playing.',
                ephemeral: true,
            });
            return;
        }

        const currentPosition = player.shoukaku.position;
        const newPosition = Math.max(0, currentPosition - seconds * 1000);

        await player.seek(newPosition);

        const formatTime = (ms: number) => {
            const s = Math.floor(ms / 1000);
            const m = Math.floor(s / 60);
            return `${m}:${(s % 60).toString().padStart(2, '0')}`;
        };

        await interaction.reply(`⏪ Rewound ${seconds} seconds to \`${formatTime(newPosition)}\``);
    },
});
