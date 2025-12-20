import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { Command } from '../../types/Command.js';
import { FILTER_PRESETS, applyFilter } from '../../utils/filters.js';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('filter')
        .setDescription('Apply an audio filter to the music')
        .addStringOption((option) =>
            option
                .setName('name')
                .setDescription('Filter to apply')
                .setRequired(true)
                .addChoices(
                    { name: 'None (Remove all)', value: 'none' },
                    { name: 'Bass Boost', value: 'bassboost' },
                    { name: 'Heavy Bass', value: 'bassboost_heavy' },
                    { name: 'Nightcore', value: 'nightcore' },
                    { name: 'Vaporwave', value: 'vaporwave' },
                    { name: '8D Audio', value: '8d' },
                    { name: 'Karaoke', value: 'karaoke' },
                    { name: 'Tremolo', value: 'tremolo' },
                    { name: 'Vibrato', value: 'vibrato' },
                    { name: 'Soft', value: 'soft' },
                    { name: 'Pop', value: 'pop' },
                    { name: 'Rock', value: 'rock' },
                    { name: 'Electronic', value: 'electronic' }
                )
        ),
    category: 'music',
    cooldown: 5,
    guildOnly: true,
    requiredModule: 'music',

    async execute(interaction, client) {
        const filterName = interaction.options.getString('name', true);
        const player = client.music.players.get(interaction.guildId!);

        if (!player || !player.queue.current) {
            await interaction.reply({
                content: '❌ No music is currently playing.',
                ephemeral: true,
            });
            return;
        }

        const preset = FILTER_PRESETS[filterName];
        if (!preset) {
            await interaction.reply({
                content: `❌ Unknown filter: ${filterName}`,
                ephemeral: true,
            });
            return;
        }

        await interaction.deferReply();

        try {
            const success = await applyFilter(player, filterName);

            if (!success) {
                await interaction.editReply('❌ Failed to apply the filter.');
                return;
            }

            // Store the current filter in player data
            player.data.set('currentFilter', filterName === 'none' ? null : filterName);

            const embed = new EmbedBuilder()
                .setColor(0x5865f2)
                .setTitle(filterName === 'none' ? '🎛️ Filters Removed' : `🎛️ Filter Applied: ${preset.name}`)
                .setDescription(preset.description)
                .setFooter({ text: 'Note: Filter changes may take a moment to take effect' });

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Filter error:', error);
            await interaction.editReply('❌ An error occurred while applying the filter.');
        }
    },
});
