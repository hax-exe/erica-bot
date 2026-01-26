import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/Command.js';
import { validateVoiceChannel } from '../../utils/voiceChannel.js';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('volume')
        .setDescription('Set the music volume')
        .addIntegerOption((option) =>
            option
                .setName('level')
                .setDescription('Volume level (0-100)')
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(100)
        ),
    category: 'music',
    cooldown: 3,
    guildOnly: true,
    requiredModule: 'music',

    async execute(interaction, client) {
        const volume = interaction.options.getInteger('level', true);
        const player = client.music.players.get(interaction.guildId!);
        const validation = validateVoiceChannel(interaction, player);

        if (!validation.valid) {
            await interaction.reply({ content: validation.message, ephemeral: true });
            return;
        }

        validation.player.setVolume(volume);

        const emoji = volume === 0 ? '🔇' : volume < 30 ? '🔈' : volume < 70 ? '🔉' : '🔊';

        await interaction.reply(`${emoji} Volume set to **${volume}%**`);
    },
});

