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
        .setName('deposit')
        .setDescription('Deposit coins into your bank')
        .addStringOption((option) =>
            option
                .setName('amount')
                .setDescription('Amount to deposit (number or "all")')
                .setRequired(true)
        ),
    category: 'economy',
    cooldown: 3,
    guildOnly: true,
    requiredModule: 'economy',

    async execute(interaction) {
        const amountInput = interaction.options.getString('amount', true).toLowerCase();
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

        // Parse amount - handle "all" or numeric value
        let amount: number;
        if (amountInput === 'all') {
            amount = wallet;
        } else {
            amount = parseInt(amountInput, 10);
            if (isNaN(amount) || amount < 1) {
                await interaction.reply({
                    content: '❌ Please enter a valid number or "all".',
                    ephemeral: true,
                });
                return;
            }
        }

        if (amount === 0) {
            await interaction.reply({
                content: '❌ You have no coins to deposit.',
                ephemeral: true,
            });
            return;
        }

        if (wallet < amount) {
            await interaction.reply({
                content: `❌ You don't have enough coins. Your wallet: ${wallet.toLocaleString()} ${currencyName}`,
                ephemeral: true,
            });
            return;
        }

        const newWallet = wallet - amount;
        const newBank = (memberData?.bank ?? 0) + amount;

        await db.update(guildMembers)
            .set({
                balance: newWallet,
                bank: newBank,
                updatedAt: new Date(),
            })
            .where(and(
                eq(guildMembers.guildId, guildId),
                eq(guildMembers.odId, userId)
            ));

        const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle(`${currencySymbol} Deposit Successful!`)
            .setDescription(`Deposited **${amount.toLocaleString()}** ${currencyName} to your bank.`)
            .addFields(
                { name: '💰 Wallet', value: `${newWallet.toLocaleString()} ${currencyName}`, inline: true },
                { name: '🏦 Bank', value: `${newBank.toLocaleString()} ${currencyName}`, inline: true },
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },
});
