import {
    SlashCommandBuilder,
    EmbedBuilder,
} from 'discord.js';
import { Command } from '../../types/Command.js';
import { db } from '../../db/index.js';
import { guildMembers } from '../../db/schema/index.js';
import { eq, and, sql, or, lt, isNull } from 'drizzle-orm';
import { ensureGuildExists } from '../../services/leveling.js';
import { getEconomySettings, getDefaultEconomySettings } from '../../services/settingsCache.js';

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

        // Get economy settings from cache
        const settings = await getEconomySettings(guildId);
        const defaults = getDefaultEconomySettings();

        const minAmount = settings?.workMinAmount ?? defaults.workMinAmount;
        const maxAmount = settings?.workMaxAmount ?? defaults.workMaxAmount;
        const cooldownSeconds = settings?.workCooldown ?? defaults.workCooldown;
        const currencyName = settings?.currencyName ?? defaults.currencyName;
        const currencySymbol = settings?.currencySymbol ?? defaults.currencySymbol;

        // Calculate random earnings
        const earnings = Math.floor(Math.random() * (maxAmount - minAmount + 1)) + minAmount;
        const response = workResponses[Math.floor(Math.random() * workResponses.length)];
        const now = new Date();

        // Try atomic update with cooldown check
        // This prevents exploiting the cooldown by sending multiple requests
        const cooldownThreshold = new Date(now.getTime() - cooldownSeconds * 1000);

        const updateResult = await db.update(guildMembers)
            .set({
                balance: sql`${guildMembers.balance} + ${earnings}`,
                lastWork: now,
                updatedAt: now,
            })
            .where(and(
                eq(guildMembers.guildId, guildId),
                eq(guildMembers.odId, userId),
                or(
                    isNull(guildMembers.lastWork),
                    lt(guildMembers.lastWork, cooldownThreshold)
                )
            ))
            .returning({ newBalance: guildMembers.balance });

        if (updateResult.length > 0) {
            // Success - worked and earned coins
            const embed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle(`${currencySymbol} Work Complete!`)
                .setDescription(`${response} **${earnings.toLocaleString()}** ${currencyName}!`)
                .addFields(
                    { name: 'New Balance', value: `${(updateResult[0]!.newBalance ?? 0).toLocaleString()} ${currencyName}`, inline: true },
                )
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
            return;
        }

        // Check if user doesn't exist yet
        const memberData = await db.query.guildMembers.findFirst({
            where: and(
                eq(guildMembers.guildId, guildId),
                eq(guildMembers.odId, userId)
            ),
        });

        if (!memberData) {
            // First time working - create member record
            await ensureGuildExists(guildId);
            await db.insert(guildMembers).values({
                guildId,
                odId: userId,
                balance: earnings,
                lastWork: now,
            });

            const embed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle(`${currencySymbol} Work Complete!`)
                .setDescription(`${response} **${earnings.toLocaleString()}** ${currencyName}!`)
                .addFields(
                    { name: 'New Balance', value: `${earnings.toLocaleString()} ${currencyName}`, inline: true },
                )
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
            return;
        }

        // Still on cooldown - calculate remaining time
        const lastWork = new Date(memberData.lastWork!);
        const timeSince = now.getTime() - lastWork.getTime();
        const timeLeft = (cooldownSeconds * 1000) - timeSince;
        const minutes = Math.floor(timeLeft / (60 * 1000));
        const seconds = Math.floor((timeLeft % (60 * 1000)) / 1000);

        await interaction.reply({
            content: `⏰ You can work again in **${minutes}m ${seconds}s**`,
            ephemeral: true,
        });
    },
});
