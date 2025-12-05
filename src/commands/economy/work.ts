import {
    SlashCommandBuilder,
    EmbedBuilder,
} from 'discord.js';
import { Command } from '../../types/Command.js';
import { db } from '../../db/index.js';
import { guildMembers, economySettings } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { ensureGuildExists } from '../../services/leveling.js';

const workResponses = [
    'You worked as a programmer and earned',
    'You delivered pizzas and earned',
    'You walked dogs and earned',
    'You taught coding classes and earned',
    'You fixed a computer and earned',
    'You streamed on Twitch and earned',
    'You wrote some articles and earned',
    'You designed a logo and earned',
    'You edited a video and earned',
    'You played music on the street and earned',
];

export default new Command({
    data: new SlashCommandBuilder()
        .setName('work')
        .setDescription('Work to earn some coins'),
    category: 'economy',
    cooldown: 5,
    guildOnly: true,
    requiredModule: 'economy',

    async execute(interaction) {
        const userId = interaction.user.id;
        const guildId = interaction.guildId!;

        // Get economy settings
        const settings = await db.query.economySettings.findFirst({
            where: eq(economySettings.guildId, guildId),
        });

        const minAmount = settings?.workMinAmount ?? 50;
        const maxAmount = settings?.workMaxAmount ?? 200;
        const cooldownSeconds = settings?.workCooldown ?? 3600;
        const currencyName = settings?.currencyName ?? 'coins';
        const currencySymbol = settings?.currencySymbol ?? '🪙';

        // Get member data
        const memberData = await db.query.guildMembers.findFirst({
            where: and(
                eq(guildMembers.guildId, guildId),
                eq(guildMembers.odId, userId)
            ),
        });

        // Check cooldown
        const now = new Date();
        const cooldownMs = cooldownSeconds * 1000;

        if (memberData?.lastWork) {
            const lastWork = new Date(memberData.lastWork);
            const timeSince = now.getTime() - lastWork.getTime();

            if (timeSince < cooldownMs) {
                const timeLeft = cooldownMs - timeSince;
                const minutes = Math.floor(timeLeft / (60 * 1000));
                const seconds = Math.floor((timeLeft % (60 * 1000)) / 1000);

                await interaction.reply({
                    content: `⏰ You can work again in **${minutes}m ${seconds}s**`,
                    ephemeral: true,
                });
                return;
            }
        }

        // Calculate random earnings
        const earnings = Math.floor(Math.random() * (maxAmount - minAmount + 1)) + minAmount;
        const newBalance = (memberData?.balance ?? 0) + earnings;
        const response = workResponses[Math.floor(Math.random() * workResponses.length)];

        if (memberData) {
            await db.update(guildMembers)
                .set({
                    balance: newBalance,
                    lastWork: now,
                    updatedAt: now,
                })
                .where(and(
                    eq(guildMembers.guildId, guildId),
                    eq(guildMembers.odId, userId)
                ));
        } else {
            await ensureGuildExists(guildId);
            await db.insert(guildMembers).values({
                guildId,
                odId: userId,
                balance: earnings,
                lastWork: now,
            });
        }

        const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle(`${currencySymbol} Work Complete!`)
            .setDescription(`${response} **${earnings.toLocaleString()}** ${currencyName}!`)
            .addFields(
                { name: 'New Balance', value: `${newBalance.toLocaleString()} ${currencyName}`, inline: true },
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },
});
