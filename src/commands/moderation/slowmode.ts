import {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
    TextChannel,
    ChannelType,
} from 'discord.js';
import { Command } from '../../types/Command.js';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('slowmode')
        .setDescription('Set the slowmode for a channel')
        .addIntegerOption((option) =>
            option
                .setName('seconds')
                .setDescription('Slowmode duration in seconds (0 to disable)')
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(21600) // 6 hours max
        )
        .addChannelOption((option) =>
            option
                .setName('channel')
                .setDescription('The channel to set slowmode in (defaults to current)')
                .addChannelTypes(ChannelType.GuildText)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    category: 'moderation',
    cooldown: 3,
    guildOnly: true,
    requiredModule: 'moderation',

    async execute(interaction) {
        const seconds = interaction.options.getInteger('seconds', true);
        const channel = (interaction.options.getChannel('channel') || interaction.channel) as TextChannel;

        if (!channel || channel.type !== ChannelType.GuildText) {
            await interaction.reply({
                content: '❌ Invalid channel.',
                ephemeral: true,
            });
            return;
        }

        await channel.setRateLimitPerUser(seconds);

        const embed = new EmbedBuilder()
            .setColor(seconds === 0 ? 0x00ff00 : 0xffcc00)
            .setTitle(seconds === 0 ? '🔓 Slowmode Disabled' : '🐢 Slowmode Enabled')
            .addFields(
                { name: 'Channel', value: `${channel}`, inline: true },
                { name: 'Duration', value: seconds === 0 ? 'Disabled' : formatDuration(seconds), inline: true },
                { name: 'Moderator', value: interaction.user.tag, inline: true },
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },
});

function formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
}
