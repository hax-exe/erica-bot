import {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
} from 'discord.js';
import { Command } from '../../types/Command.js';
import { db } from '../../db/index.js';
import { warnings } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('clearwarnings')
        .setDescription('Clear all warnings for a user')
        .addUserOption((option) =>
            option
                .setName('user')
                .setDescription('The user to clear warnings for')
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    category: 'moderation',
    cooldown: 5,
    guildOnly: true,
    requiredModule: 'moderation',

    async execute(interaction) {
        const targetUser = interaction.options.getUser('user', true);

        const deleted = await db.delete(warnings).where(
            and(
                eq(warnings.guildId, interaction.guildId!),
                eq(warnings.userId, targetUser.id)
            )
        ).returning();

        if (deleted.length === 0) {
            await interaction.reply({
                content: `ℹ️ ${targetUser.tag} has no warnings to clear.`,
                ephemeral: true,
            });
            return;
        }

        const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle('✅ Warnings Cleared')
            .setDescription(`Cleared **${deleted.length}** warning(s) for ${targetUser.tag}`)
            .addFields(
                { name: 'User', value: `${targetUser.tag} (${targetUser.id})`, inline: true },
                { name: 'Moderator', value: interaction.user.tag, inline: true },
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },
});
