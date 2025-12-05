import {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
} from 'discord.js';
import { Command } from '../../types/Command.js';
import { db } from '../../db/index.js';
import { guildMembers } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { getLevelFromXp, getTotalXpForLevel } from '../../services/leveling.js';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('setlevel')
        .setDescription('Set a user\'s level (Admin only)')
        .addUserOption((option) =>
            option
                .setName('user')
                .setDescription('The user to modify')
                .setRequired(true)
        )
        .addIntegerOption((option) =>
            option
                .setName('level')
                .setDescription('The level to set')
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(1000)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    category: 'leveling',
    cooldown: 5,
    guildOnly: true,
    requiredModule: 'leveling',

    async execute(interaction) {
        const targetUser = interaction.options.getUser('user', true);
        const level = interaction.options.getInteger('level', true);

        // Calculate XP for the level
        const xp = getTotalXpForLevel(level);

        // Update or create member record
        const existing = await db.query.guildMembers.findFirst({
            where: and(
                eq(guildMembers.guildId, interaction.guildId!),
                eq(guildMembers.odId, targetUser.id)
            ),
        });

        if (existing) {
            await db.update(guildMembers)
                .set({ level, xp, updatedAt: new Date() })
                .where(and(
                    eq(guildMembers.guildId, interaction.guildId!),
                    eq(guildMembers.odId, targetUser.id)
                ));
        } else {
            await db.insert(guildMembers).values({
                guildId: interaction.guildId!,
                odId: targetUser.id,
                level,
                xp,
            });
        }

        const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle('✅ Level Updated')
            .addFields(
                { name: 'User', value: targetUser.tag, inline: true },
                { name: 'New Level', value: `${level}`, inline: true },
                { name: 'New XP', value: `${xp.toLocaleString()}`, inline: true },
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },
});
