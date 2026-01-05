import {
    SlashCommandBuilder,
    EmbedBuilder,
} from 'discord.js';
import { Command } from '../../types/Command.js';
import { db } from '../../db/index.js';
import { guildMembers, economySettings } from '../../db/schema/index.js';
import { eq } from 'drizzle-orm';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('richest')
        .setDescription('View the richest users in the server')
        .addIntegerOption((option) =>
            option
                .setName('page')
                .setDescription('Page number')
                .setMinValue(1)
        ),
    category: 'economy',
    cooldown: 10,
    guildOnly: true,
    requiredModule: 'economy',

    async execute(interaction, client) {
        const page = interaction.options.getInteger('page') || 1;
        const pageSize = 10;
        const guildId = interaction.guildId!;

        await interaction.deferReply();

        // Get settings
        const settings = await db.query.economySettings.findFirst({
            where: eq(economySettings.guildId, guildId),
        });
        const currencyName = settings?.currencyName ?? 'coins';
        const currencySymbol = settings?.currencySymbol ?? '🪙';

        // Get all members sorted by total wealth (wallet + bank)
        const allMembers = await db.query.guildMembers.findMany({
            where: eq(guildMembers.guildId, guildId),
        });

        // Sort by total wealth
        const sortedMembers = allMembers
            .map((m) => ({
                ...m,
                total: (m.balance ?? 0) + (m.bank ?? 0),
            }))
            .filter((m) => m.total > 0)
            .sort((a, b) => b.total - a.total);

        if (sortedMembers.length === 0) {
            await interaction.editReply('❌ No one has any coins yet!');
            return;
        }

        const totalPages = Math.ceil(sortedMembers.length / pageSize);

        if (page > totalPages) {
            await interaction.editReply(`❌ Invalid page. Total pages: ${totalPages}`);
            return;
        }

        const start = (page - 1) * pageSize;
        const pageMembers = sortedMembers.slice(start, start + pageSize);

        // Build leaderboard entries
        const entries = await Promise.all(
            pageMembers.map(async (member, index) => {
                const rank = start + index + 1;
                const user = await client.users.fetch(member.odId).catch(() => null);
                const username = user?.tag || `Unknown (${member.odId})`;

                const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `**${rank}.**`;

                return `${medal} ${username}\n${currencySymbol} ${member.total.toLocaleString()} ${currencyName}`;
            })
        );

        // Find user's rank
        const userRank = sortedMembers.findIndex((m) => m.odId === interaction.user.id) + 1;
        const userData = sortedMembers.find((m) => m.odId === interaction.user.id);

        const embed = new EmbedBuilder()
            .setColor(0xffd700)
            .setTitle(`${currencySymbol} ${interaction.guild!.name} - Richest Users`)
            .setDescription(entries.join('\n\n'))
            .setFooter({
                text: `Page ${page}/${totalPages} • Your rank: #${userRank || 'Unranked'} (${(userData?.total ?? 0).toLocaleString()} ${currencyName})`
            })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    },
});
