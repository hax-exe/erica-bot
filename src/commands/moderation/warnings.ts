import {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
} from 'discord.js';
import { Command } from '../../types/Command.js';
import { db } from '../../db/index.js';
import { warnings } from '../../db/schema/index.js';
import { eq, and, desc } from 'drizzle-orm';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('warnings')
        .setDescription('View warnings for a user')
        .addUserOption((option) =>
            option
                .setName('user')
                .setDescription('The user to check warnings for')
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    category: 'moderation',
    cooldown: 5,
    guildOnly: true,
    requiredModule: 'moderation',

    async execute(interaction, client) {
        const targetUser = interaction.options.getUser('user', true);

        const userWarnings = await db.query.warnings.findMany({
            where: and(
                eq(warnings.guildId, interaction.guildId!),
                eq(warnings.userId, targetUser.id)
            ),
            orderBy: [desc(warnings.createdAt)],
            limit: 10,
        });

        if (userWarnings.length === 0) {
            await interaction.reply({
                content: `✅ ${targetUser.tag} has no warnings.`,
                ephemeral: true,
            });
            return;
        }

        const embed = new EmbedBuilder()
            .setColor(0xffcc00)
            .setTitle(`⚠️ Warnings for ${targetUser.tag}`)
            .setThumbnail(targetUser.displayAvatarURL())
            .setDescription(`Total warnings: **${userWarnings.length}**`)
            .setTimestamp();

        for (const warning of userWarnings.slice(0, 10)) {
            const moderator = await client.users.fetch(warning.moderatorId).catch(() => null);
            const date = warning.createdAt ? new Date(warning.createdAt).toLocaleDateString() : 'Unknown';

            embed.addFields({
                name: `#${warning.id} • ${date}`,
                value: `**Reason:** ${warning.reason}\n**Moderator:** ${moderator?.tag || warning.moderatorId}`,
            });
        }

        if (userWarnings.length > 10) {
            embed.setFooter({ text: `Showing 10 of ${userWarnings.length} warnings` });
        }

        await interaction.reply({ embeds: [embed] });
    },
});
