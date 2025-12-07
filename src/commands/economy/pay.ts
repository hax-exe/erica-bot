import {
    SlashCommandBuilder,
    EmbedBuilder,
} from 'discord.js';
import { Command } from '../../types/Command.js';
import { atomicTransfer } from '../../db/transactions.js';
import { getEconomySettings, getDefaultEconomySettings } from '../../services/settingsCache.js';

// Maximum transfer limit per transaction
const MAX_TRANSFER_LIMIT = 100000;

export default new Command({
    data: new SlashCommandBuilder()
        .setName('pay')
        .setDescription('Pay coins to another user')
        .addUserOption((option) =>
            option
                .setName('user')
                .setDescription('The user to pay')
                .setRequired(true)
        )
        .addIntegerOption((option) =>
            option
                .setName('amount')
                .setDescription('Amount to pay')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(MAX_TRANSFER_LIMIT)
        ),
    category: 'economy',
    cooldown: 5,
    guildOnly: true,
    requiredModule: 'economy',

    async execute(interaction) {
        const targetUser = interaction.options.getUser('user', true);
        const amount = interaction.options.getInteger('amount', true);
        const userId = interaction.user.id;
        const guildId = interaction.guildId!;

        if (targetUser.id === userId) {
            await interaction.reply({
                content: '❌ You cannot pay yourself.',
                ephemeral: true,
            });
            return;
        }

        if (targetUser.bot) {
            await interaction.reply({
                content: '❌ You cannot pay bots.',
                ephemeral: true,
            });
            return;
        }

        // Get settings from cache
        const settings = await getEconomySettings(guildId);
        const defaults = getDefaultEconomySettings();
        const currencyName = settings?.currencyName ?? defaults.currencyName;
        const currencySymbol = settings?.currencySymbol ?? defaults.currencySymbol;

        // Defer reply since transfer might take a moment
        await interaction.deferReply();

        // Use atomic transfer to prevent race conditions
        // This wraps both debit and credit in a transaction
        const result = await atomicTransfer(guildId, userId, targetUser.id, amount);

        if (!result.success) {
            await interaction.editReply({
                content: `❌ ${result.error || 'Transfer failed'}. Please check your balance.`,
            });
            return;
        }

        const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle(`${currencySymbol} Payment Sent!`)
            .setDescription(`You paid **${amount.toLocaleString()}** ${currencyName} to ${targetUser.tag}`)
            .addFields(
                { name: 'Your New Balance', value: `${result.senderBalance?.toLocaleString() ?? 0} ${currencyName}`, inline: true },
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    },
});
