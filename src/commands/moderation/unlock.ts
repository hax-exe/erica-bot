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
        .setName('unlock')
        .setDescription('Unlock a channel to allow members to send messages')
        .addChannelOption((option) =>
            option
                .setName('channel')
                .setDescription('The channel to unlock (defaults to current)')
                .addChannelTypes(ChannelType.GuildText)
        )
        .addStringOption((option) =>
            option
                .setName('reason')
                .setDescription('Reason for unlocking the channel')
                .setMaxLength(500)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    category: 'moderation',
    cooldown: 3,
    guildOnly: true,
    requiredModule: 'moderation',

    async execute(interaction) {
        const channel = (interaction.options.getChannel('channel') || interaction.channel) as TextChannel;
        const reason = interaction.options.getString('reason') || 'No reason provided';

        if (!channel || channel.type !== ChannelType.GuildText) {
            await interaction.reply({
                content: '❌ Invalid channel.',
                ephemeral: true,
            });
            return;
        }

        // Get the @everyone role
        const everyoneRole = interaction.guild!.roles.everyone;

        // Reset send messages permission (inherit from category or allow)
        await channel.permissionOverwrites.edit(everyoneRole, {
            SendMessages: null,
        });

        const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle('🔓 Channel Unlocked')
            .setDescription(`${channel} has been unlocked.`)
            .addFields(
                { name: 'Moderator', value: interaction.user.tag, inline: true },
                { name: 'Reason', value: reason },
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },
});
