import {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
} from 'discord.js';
import { Command } from '../../types/Command.js';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('unban')
        .setDescription('Unban a user from the server')
        .addStringOption((option) =>
            option
                .setName('user_id')
                .setDescription('The user ID to unban')
                .setRequired(true)
        )
        .addStringOption((option) =>
            option
                .setName('reason')
                .setDescription('Reason for the unban')
                .setMaxLength(500)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    category: 'moderation',
    cooldown: 3,
    guildOnly: true,
    requiredModule: 'moderation',

    async execute(interaction) {
        const userId = interaction.options.getString('user_id', true);
        const reason = interaction.options.getString('reason') || 'No reason provided';
        const moderator = interaction.user;

        // Validate user ID format
        if (!/^\d{17,20}$/.test(userId)) {
            await interaction.reply({
                content: '❌ Invalid user ID format.',
                ephemeral: true,
            });
            return;
        }

        try {
            // Check if user is actually banned
            const banInfo = await interaction.guild!.bans.fetch(userId).catch(() => null);

            if (!banInfo) {
                await interaction.reply({
                    content: '❌ This user is not banned.',
                    ephemeral: true,
                });
                return;
            }

            // Unban the user
            await interaction.guild!.members.unban(userId, reason);

            const embed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle('✅ User Unbanned')
                .addFields(
                    { name: 'User', value: `${banInfo.user.tag} (${userId})`, inline: true },
                    { name: 'Moderator', value: moderator.tag, inline: true },
                    { name: 'Reason', value: reason },
                )
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
        } catch {
            await interaction.reply({
                content: '❌ Failed to unban user. Please check the user ID.',
                ephemeral: true,
            });
        }
    },
});
