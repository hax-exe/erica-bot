import {
    SlashCommandBuilder,
    EmbedBuilder,
    AttachmentBuilder,
} from 'discord.js';
import { Command } from '../../types/Command.js';
import { db } from '../../db/index.js';
import { guildMembers } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { getXpProgress, getLevelFromXp, getXpForLevel } from '../../services/leveling.js';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('rank')
        .setDescription('View your or another user\'s rank')
        .addUserOption((option) =>
            option
                .setName('user')
                .setDescription('The user to check (defaults to yourself)')
        ),
    category: 'leveling',
    cooldown: 5,
    guildOnly: true,
    requiredModule: 'leveling',

    async execute(interaction, client) {
        const targetUser = interaction.options.getUser('user') || interaction.user;

        await interaction.deferReply();

        // Get member data
        const memberData = await db.query.guildMembers.findFirst({
            where: and(
                eq(guildMembers.guildId, interaction.guildId!),
                eq(guildMembers.odId, targetUser.id)
            ),
        });

        const xp = memberData?.xp ?? 0;
        const level = memberData?.level ?? 0;
        const totalMessages = memberData?.totalMessages ?? 0;
        const progress = getXpProgress(xp);

        // Get rank position
        const allMembers = await db.query.guildMembers.findMany({
            where: eq(guildMembers.guildId, interaction.guildId!),
            orderBy: (m, { desc }) => [desc(m.xp)],
        });

        const rank = allMembers.findIndex((m) => m.odId === targetUser.id) + 1;

        // Create progress bar
        const progressBar = createProgressBar(progress.percentage);

        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle(`📊 Rank Card`)
            .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
            .addFields(
                { name: 'User', value: `${targetUser.tag}`, inline: true },
                { name: 'Rank', value: `#${rank || 'Unranked'}`, inline: true },
                { name: 'Level', value: `${level}`, inline: true },
                { name: 'Total XP', value: `${xp.toLocaleString()}`, inline: true },
                { name: 'Messages', value: `${totalMessages.toLocaleString()}`, inline: true },
                { name: 'Next Level', value: `${progress.current.toLocaleString()} / ${progress.required.toLocaleString()} XP`, inline: true },
                { name: 'Progress', value: `${progressBar} ${progress.percentage}%` },
            )
            .setFooter({ text: `${getXpForLevel(level).toLocaleString()} XP needed for next level` })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    },
});

function createProgressBar(percentage: number, length = 20): string {
    const filled = Math.round((percentage / 100) * length);
    const empty = length - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
}
