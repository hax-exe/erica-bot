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

        // Get settings
        const settings = await db.query.economySettings.findFirst({
            where: eq(economySettings.guildId, guildId),
        });
        const currencyName = settings?.currencyName ?? 'coins';
        const currencySymbol = settings?.currencySymbol ?? '🪙';

        // Get sender data
        const senderData = await db.query.guildMembers.findFirst({
            where: and(
                eq(guildMembers.guildId, guildId),
                eq(guildMembers.odId, userId)
            ),
        });

        const senderWallet = senderData?.balance ?? 0;

        if (senderWallet < amount) {
            await interaction.reply({
                content: `❌ You don't have enough coins. Your wallet: ${senderWallet.toLocaleString()} ${currencyName}`,
                ephemeral: true,
            });
            return;
        }

        // Get receiver data
        const receiverData = await db.query.guildMembers.findFirst({
            where: and(
                eq(guildMembers.guildId, guildId),
                eq(guildMembers.odId, targetUser.id)
            ),
        });

        // Update sender
        await db.update(guildMembers)
            .set({
                balance: senderWallet - amount,
                updatedAt: new Date(),
            })
            .where(and(
                eq(guildMembers.guildId, guildId),
                eq(guildMembers.odId, userId)
            ));

        // Update receiver
        if (receiverData) {
            await db.update(guildMembers)
                .set({
                    balance: (receiverData.balance ?? 0) + amount,
                    updatedAt: new Date(),
                })
                .where(and(
                    eq(guildMembers.guildId, guildId),
                    eq(guildMembers.odId, targetUser.id)
                ));
        } else {
            await db.insert(guildMembers).values({
                guildId,
                odId: targetUser.id,
                balance: amount,
            });
        }

        const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle(`${currencySymbol} Payment Sent!`)
            .setDescription(`You paid **${amount.toLocaleString()}** ${currencyName} to ${targetUser.tag}`)
            .addFields(
                { name: 'Your New Balance', value: `${(senderWallet - amount).toLocaleString()} ${currencyName}`, inline: true },
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },
});
