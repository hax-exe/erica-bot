import {
    SlashCommandBuilder,
    EmbedBuilder,
} from 'discord.js';
import { Command } from '../../types/Command.js';
import { db } from '../../db/index.js';
import { guildMembers } from '../../db/schema/index.js';
import { eq, and, gte } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { getEconomySettings, getDefaultEconomySettings } from '../../services/settingsCache.js';

// Maximum bet limit to prevent excessive gambling
const MAX_BET_LIMIT = 10000;

export default new Command({
    data: new SlashCommandBuilder()
        .setName('coinflip')
        .setDescription('Gamble your coins on a coin flip')
        .addIntegerOption((option) =>
            option
                .setName('amount')
                .setDescription('Amount to bet')
                .setRequired(true)
                .setMinValue(10)
                .setMaxValue(MAX_BET_LIMIT)
        )
        .addStringOption((option) =>
            option
                .setName('choice')
                .setDescription('Heads or Tails')
                .setRequired(true)
                .addChoices(
                    { name: 'Heads', value: 'heads' },
                    { name: 'Tails', value: 'tails' },
                )
        ),
    category: 'economy',
    cooldown: 5,
    guildOnly: true,
    requiredModule: 'economy',

    async execute(interaction) {
        const amount = interaction.options.getInteger('amount', true);
        const choice = interaction.options.getString('choice', true);
        const userId = interaction.user.id;
        const guildId = interaction.guildId!;

        // Get settings from cache
        const settings = await getEconomySettings(guildId);
        const defaults = getDefaultEconomySettings();
        const currencyName = settings?.currencyName ?? defaults.currencyName;
        const currencySymbol = settings?.currencySymbol ?? defaults.currencySymbol;

        // Flip the coin first to determine outcome
        const result = Math.random() < 0.5 ? 'heads' : 'tails';
        const won = choice === result;
        const balanceChange = won ? amount : -amount;

        // Atomic update: check balance and update in single query
        // This prevents race conditions where user could bet more than they have
        const updateResult = await db.update(guildMembers)
            .set({
                balance: sql`${guildMembers.balance} + ${balanceChange}`,
                updatedAt: new Date(),
            })
            .where(and(
                eq(guildMembers.guildId, guildId),
                eq(guildMembers.odId, userId),
                // Only allow if they have enough balance to cover a loss
                gte(guildMembers.balance, amount)
            ))
            .returning({ newBalance: guildMembers.balance });

        if (updateResult.length === 0) {
            // Either user doesn't exist or has insufficient balance
            const memberData = await db.query.guildMembers.findFirst({
                where: and(
                    eq(guildMembers.guildId, guildId),
                    eq(guildMembers.odId, userId)
                ),
            });

            const wallet = memberData?.balance ?? 0;
            await interaction.reply({
                content: `❌ You don't have enough coins. Your wallet: ${wallet.toLocaleString()} ${currencyName} (need at least ${amount.toLocaleString()})`,
                ephemeral: true,
            });
            return;
        }

        const newBalance = updateResult[0]!.newBalance ?? 0;
        const coinEmoji = result === 'heads' ? '🪙' : '⭐';

        const embed = new EmbedBuilder()
            .setColor(won ? 0x00ff00 : 0xff0000)
            .setTitle(`${coinEmoji} Coin Flip - ${result.charAt(0).toUpperCase() + result.slice(1)}!`)
            .setDescription(
                won
                    ? `🎉 You won **${amount.toLocaleString()}** ${currencyName}!`
                    : `😢 You lost **${amount.toLocaleString()}** ${currencyName}!`
            )
            .addFields(
                { name: 'Your Choice', value: choice.charAt(0).toUpperCase() + choice.slice(1), inline: true },
                { name: 'Result', value: result.charAt(0).toUpperCase() + result.slice(1), inline: true },
                { name: 'New Balance', value: `${newBalance.toLocaleString()} ${currencyName}`, inline: true },
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },
});
