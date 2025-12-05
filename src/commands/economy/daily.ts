import {
    SlashCommandBuilder,
    EmbedBuilder,
} from 'discord.js';
import { Command } from '../../types/Command.js';
import { db } from '../../db/index.js';
import { guildMembers, economySettings } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';

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

        // Get economy settings
        const settings = await db.query.economySettings.findFirst({
            where: eq(economySettings.guildId, guildId),
        });

        const dailyAmount = settings?.dailyAmount ?? 100;
        const currencyName = settings?.currencyName ?? 'coins';
        const currencySymbol = settings?.currencySymbol ?? '🪙';

        // Get member data
        const memberData = await db.query.guildMembers.findFirst({
            where: and(
                eq(guildMembers.guildId, guildId),
                eq(guildMembers.odId, userId)
            ),
        });

        // Check cooldown (24 hours)
        const now = new Date();
        const cooldownMs = 24 * 60 * 60 * 1000;

        if (memberData?.lastDaily) {
            const lastClaim = new Date(memberData.lastDaily);
            const timeSince = now.getTime() - lastClaim.getTime();

            if (timeSince < cooldownMs) {
                const timeLeft = cooldownMs - timeSince;
                const hours = Math.floor(timeLeft / (60 * 60 * 1000));
                const minutes = Math.floor((timeLeft % (60 * 60 * 1000)) / (60 * 1000));

                await interaction.reply({
                    content: `⏰ You can claim your daily reward in **${hours}h ${minutes}m**`,
                    ephemeral: true,
                });
                return;
            }
        }

        // Give reward
        const newBalance = (memberData?.balance ?? 0) + dailyAmount;

        if (memberData) {
            await db.update(guildMembers)
                .set({
                    balance: newBalance,
                    lastDaily: now,
                    updatedAt: now,
                })
                .where(and(
                    eq(guildMembers.guildId, guildId),
                    eq(guildMembers.odId, userId)
                ));
        } else {
            await db.insert(guildMembers).values({
                guildId,
                odId: userId,
                balance: dailyAmount,
                lastDaily: now,
            });
        }

        const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle(`${currencySymbol} Daily Reward Claimed!`)
            .setDescription(`You received **${dailyAmount.toLocaleString()}** ${currencyName}!`)
            .addFields(
                { name: 'New Balance', value: `${newBalance.toLocaleString()} ${currencyName}`, inline: true },
            )
            .setFooter({ text: 'Come back in 24 hours for another reward!' })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },
});
