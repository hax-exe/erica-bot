import {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
} from 'discord.js';
import { Command } from '../../types/Command.js';
import { db } from '../../db/index.js';
import { warnings } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { ensureGuildExists } from '../../services/leveling.js';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Warn a user for rule violations')
        .addUserOption((option) =>
            option
                .setName('user')
                .setDescription('The user to warn')
                .setRequired(true)
        )
        .addStringOption((option) =>
            option
                .setName('reason')
                .setDescription('Reason for the warning')
                .setRequired(true)
                .setMaxLength(500)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    category: 'moderation',
    cooldown: 3,
    guildOnly: true,
    requiredModule: 'moderation',

    async execute(interaction) {
        const targetUser = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason', true);
        const moderator = interaction.user;

        if (targetUser.id === interaction.user.id) {
            await interaction.reply({
                content: '❌ You cannot warn yourself.',
                ephemeral: true,
            });
            return;
        }

        if (targetUser.bot) {
            await interaction.reply({
                content: '❌ You cannot warn bots.',
                ephemeral: true,
            });
            return;
        }

        // Ensure guild exists in database before creating warning
        await ensureGuildExists(interaction.guildId!);

        // Add warning to database
        await db.insert(warnings).values({
            guildId: interaction.guildId!,
            userId: targetUser.id,
            moderatorId: moderator.id,
            reason,
        });

        // Count total warnings
        const userWarnings = await db.query.warnings.findMany({
            where: and(
                eq(warnings.guildId, interaction.guildId!),
                eq(warnings.userId, targetUser.id)
            ),
        });

        const warningCount = userWarnings.length;

        const embed = new EmbedBuilder()
            .setColor(0xffcc00)
            .setTitle('⚠️ User Warned')
            .setThumbnail(targetUser.displayAvatarURL())
            .addFields(
                { name: 'User', value: `${targetUser.tag} (${targetUser.id})`, inline: true },
                { name: 'Moderator', value: moderator.tag, inline: true },
                { name: 'Total Warnings', value: `${warningCount}`, inline: true },
                { name: 'Reason', value: reason },
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });

        // DM the user
        try {
            await targetUser.send({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xffcc00)
                        .setTitle(`⚠️ You were warned in ${interaction.guild!.name}`)
                        .addFields(
                            { name: 'Reason', value: reason },
                            { name: 'Total Warnings', value: `${warningCount}` },
                        )
                        .setTimestamp(),
                ],
            });
        } catch {
            // User has DMs disabled
        }
    },
});
