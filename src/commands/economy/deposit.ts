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
        const input = interaction.options.getString('amount', true).toLowerCase();
        const userId = interaction.user.id;
        const guildId = interaction.guildId!;

        const settings = await db.query.economySettings.findFirst({
            where: eq(economySettings.guildId, guildId),
        });
        const currency = settings?.currencyName ?? 'coins';
        const symbol = settings?.currencySymbol ?? '🪙';

        const member = await db.query.guildMembers.findFirst({
            where: and(
                eq(guildMembers.guildId, guildId),
                eq(guildMembers.odId, userId)
            ),
        });

        const wallet = member?.balance ?? 0;

        let amount: number;
        if (input === 'all') {
            amount = wallet;
        } else {
            amount = parseInt(input, 10);
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
                content: `❌ You don't have enough coins. Your wallet: ${wallet.toLocaleString()} ${currency}`,
                ephemeral: true,
            });
            return;
        }

        const newWallet = wallet - amount;
        const newBank = (member?.bank ?? 0) + amount;

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
            .setTitle(`${symbol} Deposit Successful!`)
            .setDescription(`Deposited **${amount.toLocaleString()}** ${currency} to your bank.`)
            .addFields(
                { name: '💰 Wallet', value: `${newWallet.toLocaleString()} ${currency}`, inline: true },
                { name: '🏦 Bank', value: `${newBank.toLocaleString()} ${currency}`, inline: true },
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },
});
