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
        .setName('withdraw')
        .setDescription('Withdraw coins from your bank')
        .addIntegerOption((option) =>
            option
                .setName('amount')
                .setDescription('Amount to withdraw')
                .setRequired(true)
                .setMinValue(1)
        ),
    category: 'economy',
    cooldown: 3,
    guildOnly: true,
    requiredModule: 'economy',

    async execute(interaction) {
        const amount = interaction.options.getInteger('amount', true);
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

        const bank = memberData?.bank ?? 0;

        if (bank < amount) {
            await interaction.reply({
                content: `❌ You don't have enough coins in your bank. Bank balance: ${bank.toLocaleString()} ${currencyName}`,
                ephemeral: true,
            });
            return;
        }

        const newBank = bank - amount;
        const newWallet = (memberData?.balance ?? 0) + amount;

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
            .setTitle(`${currencySymbol} Withdrawal Successful!`)
            .setDescription(`Withdrew **${amount.toLocaleString()}** ${currencyName} from your bank.`)
            .addFields(
                { name: '💰 Wallet', value: `${newWallet.toLocaleString()} ${currencyName}`, inline: true },
                { name: '🏦 Bank', value: `${newBank.toLocaleString()} ${currencyName}`, inline: true },
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },
});
