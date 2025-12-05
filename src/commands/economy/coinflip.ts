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
        .setName('coinflip')
        .setDescription('Gamble your coins on a coin flip')
        .addIntegerOption((option) =>
            option
                .setName('amount')
                .setDescription('Amount to bet')
                .setRequired(true)
                .setMinValue(10)
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

        // Get settings
        const settings = await db.query.economySettings.findFirst({
            where: eq(economySettings.guildId, guildId),
        });
        const currencyName = settings?.currencyName ?? 'coins';
        const currencySymbol = settings?.currencySymbol ?? '🪙';

        // Get member data
        const memberData = await db.query.guildMembers.findFirst({
            where: and(
                eq(guildMembers.guildId, guildId),
                eq(guildMembers.odId, userId)
            ),
        });

        const wallet = memberData?.balance ?? 0;

        if (wallet < amount) {
            await interaction.reply({
                content: `❌ You don't have enough coins. Your wallet: ${wallet.toLocaleString()} ${currencyName}`,
                ephemeral: true,
            });
            return;
        }

        // Flip the coin
        const result = Math.random() < 0.5 ? 'heads' : 'tails';
        const won = choice === result;
        const winnings = won ? amount : -amount;
        const newBalance = wallet + winnings;

        // Update balance
        await db.update(guildMembers)
            .set({
                balance: newBalance,
                updatedAt: new Date(),
            })
            .where(and(
                eq(guildMembers.guildId, guildId),
                eq(guildMembers.odId, userId)
            ));

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
