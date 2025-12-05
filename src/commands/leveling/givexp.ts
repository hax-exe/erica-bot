import {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
} from 'discord.js';
import { Command } from '../../types/Command.js';
import { db } from '../../db/index.js';
import { guildMembers } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { getLevelFromXp } from '../../services/leveling.js';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('givexp')
        .setDescription('Give XP to a user (Admin only)')
        .addUserOption((option) =>
            option
                .setName('user')
                .setDescription('The user to give XP to')
                .setRequired(true)
        )
        .addIntegerOption((option) =>
            option
                .setName('amount')
                .setDescription('Amount of XP to give')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(1000000)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    category: 'leveling',
    cooldown: 5,
    guildOnly: true,
    requiredModule: 'leveling',

    async execute(interaction) {
        const targetUser = interaction.options.getUser('user', true);
        const amount = interaction.options.getInteger('amount', true);

        // Get or create member record
        const existing = await db.query.guildMembers.findFirst({
            where: and(
                eq(guildMembers.guildId, interaction.guildId!),
                eq(guildMembers.odId, targetUser.id)
            ),
        });

        const currentXp = existing?.xp ?? 0;
        const newXp = currentXp + amount;
        const newLevel = getLevelFromXp(newXp);
        const leveledUp = newLevel > (existing?.level ?? 0);

        if (existing) {
            await db.update(guildMembers)
                .set({ xp: newXp, level: newLevel, updatedAt: new Date() })
                .where(and(
                    eq(guildMembers.guildId, interaction.guildId!),
                    eq(guildMembers.odId, targetUser.id)
                ));
        } else {
            await db.insert(guildMembers).values({
                guildId: interaction.guildId!,
                odId: targetUser.id,
                xp: newXp,
                level: newLevel,
            });
        }

        const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle('✅ XP Given')
            .addFields(
                { name: 'User', value: targetUser.tag, inline: true },
                { name: 'XP Given', value: `+${amount.toLocaleString()}`, inline: true },
                { name: 'Total XP', value: newXp.toLocaleString(), inline: true },
                { name: 'Level', value: `${newLevel}${leveledUp ? ' (Level up!)' : ''}`, inline: true },
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },
});
