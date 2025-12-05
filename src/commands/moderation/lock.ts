import {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
    TextChannel,
    ChannelType,
    OverwriteType,
} from 'discord.js';
import { Command } from '../../types/Command.js';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('lock')
        .setDescription('Lock a channel to prevent members from sending messages')
        .addChannelOption((option) =>
            option
                .setName('channel')
                .setDescription('The channel to lock (defaults to current)')
                .addChannelTypes(ChannelType.GuildText)
        )
        .addStringOption((option) =>
            option
                .setName('reason')
                .setDescription('Reason for locking the channel')
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

        // Deny send messages permission for @everyone
        await channel.permissionOverwrites.edit(everyoneRole, {
            SendMessages: false,
        });

        const embed = new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle('🔒 Channel Locked')
            .setDescription(`${channel} has been locked.`)
            .addFields(
                { name: 'Moderator', value: interaction.user.tag, inline: true },
                { name: 'Reason', value: reason },
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },
});
