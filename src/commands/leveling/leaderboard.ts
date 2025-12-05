import {
    SlashCommandBuilder,
    EmbedBuilder,
} from 'discord.js';
import { Command } from '../../types/Command.js';
import { db } from '../../db/index.js';
import { guildMembers } from '../../db/schema/index.js';
import { eq, desc } from 'drizzle-orm';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('View the server leaderboard')
        .addIntegerOption((option) =>
            option
                .setName('page')
                .setDescription('Page number')
                .setMinValue(1)
        ),
    category: 'leveling',
    cooldown: 10,
    guildOnly: true,
    requiredModule: 'leveling',

    async execute(interaction, client) {
        const page = interaction.options.getInteger('page') || 1;
        const pageSize = 10;

        await interaction.deferReply();

        // Get all members sorted by XP
        const allMembers = await db.query.guildMembers.findMany({
            where: eq(guildMembers.guildId, interaction.guildId!),
            orderBy: [desc(guildMembers.xp)],
        });

        if (allMembers.length === 0) {
            await interaction.editReply('❌ No one has earned XP yet!');
            return;
        }

        const totalPages = Math.ceil(allMembers.length / pageSize);

        if (page > totalPages) {
            await interaction.editReply(`❌ Invalid page. Total pages: ${totalPages}`);
            return;
        }

        const start = (page - 1) * pageSize;
        const pageMembers = allMembers.slice(start, start + pageSize);

        // Build leaderboard entries
        const entries = await Promise.all(
            pageMembers.map(async (member, index) => {
                const rank = start + index + 1;
                const user = await client.users.fetch(member.odId).catch(() => null);
                const username = user?.tag || `Unknown (${member.odId})`;

                const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `**${rank}.**`;

                return `${medal} ${username}\nLevel ${member.level} • ${(member.xp ?? 0).toLocaleString()} XP`;
            })
        );

        // Find user's rank
        const userRank = allMembers.findIndex((m) => m.odId === interaction.user.id) + 1;
        const userData = allMembers.find((m) => m.odId === interaction.user.id);

        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle(`🏆 ${interaction.guild!.name} Leaderboard`)
            .setDescription(entries.join('\n\n'))
            .setFooter({
                text: `Page ${page}/${totalPages} • Your rank: #${userRank || 'Unranked'} (${(userData?.xp ?? 0).toLocaleString()} XP)`
            })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    },
});
