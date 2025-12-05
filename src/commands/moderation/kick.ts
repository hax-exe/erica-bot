import {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
    GuildMember,
} from 'discord.js';
import { Command } from '../../types/Command.js';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Kick a user from the server')
        .addUserOption((option) =>
            option
                .setName('user')
                .setDescription('The user to kick')
                .setRequired(true)
        )
        .addStringOption((option) =>
            option
                .setName('reason')
                .setDescription('Reason for the kick')
                .setMaxLength(500)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
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

        if (targetUser.id === interaction.user.id) {
            await interaction.reply({
                content: '❌ You cannot kick yourself.',
                ephemeral: true,
            });
            return;
        }

        if (targetUser.id === interaction.client.user?.id) {
            await interaction.reply({
                content: '❌ I cannot kick myself.',
                ephemeral: true,
            });
            return;
        }

        // Check role hierarchy
        const botMember = interaction.guild!.members.me;
        if (!botMember) {
            await interaction.reply({
                content: '❌ Could not verify bot permissions.',
                ephemeral: true,
            });
            return;
        }

        if (targetMember.roles.highest.position >= botMember.roles.highest.position) {
            await interaction.reply({
                content: '❌ I cannot kick this user. Their role is higher than or equal to mine.',
                ephemeral: true,
            });
            return;
        }

        const executingMember = interaction.member as GuildMember;
        if (targetMember.roles.highest.position >= executingMember.roles.highest.position) {
            await interaction.reply({
                content: '❌ You cannot kick this user. Their role is higher than or equal to yours.',
                ephemeral: true,
            });
            return;
        }

        if (!targetMember.kickable) {
            await interaction.reply({
                content: '❌ I cannot kick this user.',
                ephemeral: true,
            });
            return;
        }

        // DM the user before kicking
        try {
            await targetUser.send({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xff6600)
                        .setTitle(`👢 You were kicked from ${interaction.guild!.name}`)
                        .addFields({ name: 'Reason', value: reason })
                        .setTimestamp(),
                ],
            });
        } catch {
            // User has DMs disabled
        }

        // Kick the user
        await targetMember.kick(reason);

        const embed = new EmbedBuilder()
            .setColor(0xff6600)
            .setTitle('👢 User Kicked')
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
