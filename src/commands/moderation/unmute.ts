import {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
    GuildMember,
} from 'discord.js';
import { Command } from '../../types/Command.js';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('unmute')
        .setDescription('Remove timeout from a user')
        .addUserOption((option) =>
            option
                .setName('user')
                .setDescription('The user to unmute')
                .setRequired(true)
        )
        .addStringOption((option) =>
            option
                .setName('reason')
                .setDescription('Reason for removing the timeout')
                .setMaxLength(500)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    category: 'moderation',
    cooldown: 3,
    guildOnly: true,
    requiredModule: 'moderation',

    async execute(interaction) {
        const targetUser = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason') || 'No reason provided';
        const moderator = interaction.user;

        // Get guild member
        const targetMember = interaction.guild!.members.cache.get(targetUser.id) as GuildMember | undefined;

        if (!targetMember) {
            await interaction.reply({
                content: '❌ User not found in this server.',
                ephemeral: true,
            });
            return;
        }

        if (!targetMember.isCommunicationDisabled()) {
            await interaction.reply({
                content: '❌ This user is not timed out.',
                ephemeral: true,
            });
            return;
        }

        // Remove timeout
        await targetMember.timeout(null, reason);

        const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle('🔊 Timeout Removed')
            .setThumbnail(targetUser.displayAvatarURL())
            .addFields(
                { name: 'User', value: `${targetUser.tag} (${targetUser.id})`, inline: true },
                { name: 'Moderator', value: moderator.tag, inline: true },
                { name: 'Reason', value: reason },
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },
});
