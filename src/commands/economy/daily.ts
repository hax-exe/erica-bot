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

export default new Command({
    data: new SlashCommandBuilder()
        .setName('daily')
        .setDescription('Claim your daily reward'),
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

        const dailyAmount = settings?.dailyAmount ?? defaults.dailyAmount;
        const currencyName = settings?.currencyName ?? defaults.currencyName;
        const currencySymbol = settings?.currencySymbol ?? defaults.currencySymbol;

        const now = new Date();
        // 24 hours in seconds
        const cooldownSeconds = 24 * 60 * 60;
        const cooldownThreshold = new Date(now.getTime() - cooldownSeconds * 1000);

        // Try atomic update with cooldown check
        // This prevents cooldown exploitation via rapid requests
        const updateResult = await db.update(guildMembers)
            .set({
                balance: sql`${guildMembers.balance} + ${dailyAmount}`,
                lastDaily: now,
                updatedAt: now,
            })
            .where(and(
                eq(guildMembers.guildId, guildId),
                eq(guildMembers.odId, userId),
                or(
                    isNull(guildMembers.lastDaily),
                    lt(guildMembers.lastDaily, cooldownThreshold)
                )
            ))
            .returning({ newBalance: guildMembers.balance });

        if (updateResult.length > 0) {
            // Success - claimed daily reward
            const embed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle(`${currencySymbol} Daily Reward Claimed!`)
                .setDescription(`You received **${dailyAmount.toLocaleString()}** ${currencyName}!`)
                .addFields(
                    { name: 'New Balance', value: `${(updateResult[0]!.newBalance ?? 0).toLocaleString()} ${currencyName}`, inline: true },
                )
                .setFooter({ text: 'Come back in 24 hours for another reward!' })
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
            // First time claiming - create member record
            await ensureGuildExists(guildId);
            await db.insert(guildMembers).values({
                guildId,
                odId: userId,
                balance: dailyAmount,
                lastDaily: now,
            });

            const embed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle(`${currencySymbol} Daily Reward Claimed!`)
                .setDescription(`You received **${dailyAmount.toLocaleString()}** ${currencyName}!`)
                .addFields(
                    { name: 'New Balance', value: `${dailyAmount.toLocaleString()} ${currencyName}`, inline: true },
                )
                .setFooter({ text: 'Come back in 24 hours for another reward!' })
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
            return;
        }

        // Still on cooldown - calculate remaining time
        const lastClaim = new Date(memberData.lastDaily!);
        const timeSince = now.getTime() - lastClaim.getTime();
        const timeLeft = (cooldownSeconds * 1000) - timeSince;
        const hours = Math.floor(timeLeft / (60 * 60 * 1000));
        const minutes = Math.floor((timeLeft % (60 * 60 * 1000)) / (60 * 1000));

        await interaction.reply({
            content: `⏰ You can claim your daily reward in **${hours}h ${minutes}m**`,
            ephemeral: true,
        });
    },
});
