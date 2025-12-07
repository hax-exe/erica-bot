import {
    SlashCommandBuilder,
    EmbedBuilder,
} from 'discord.js';
import { Command } from '../../types/Command.js';
import { db } from '../../db/index.js';
import { guildMembers } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { getEconomySettings, getDefaultEconomySettings } from '../../services/settingsCache.js';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('balance')
        .setDescription('Check your or another user\'s balance')
        .addUserOption((option) =>
            option
                .setName('user')
                .setDescription('The user to check (defaults to yourself)')
        ),
    category: 'economy',
    cooldown: 3,
    guildOnly: true,
    requiredModule: 'economy',

    async execute(interaction) {
        const targetUser = interaction.options.getUser('user') || interaction.user;

        // Get economy settings from cache
        const settings = await getEconomySettings(interaction.guildId!);
        const defaults = getDefaultEconomySettings();

        const currencyName = settings?.currencyName ?? defaults.currencyName;
        const currencySymbol = settings?.currencySymbol ?? defaults.currencySymbol;

        // Get member data
        const memberData = await db.query.guildMembers.findFirst({
            where: and(
                eq(guildMembers.guildId, interaction.guildId!),
                eq(guildMembers.odId, targetUser.id)
            ),
        });

        const wallet = memberData?.balance ?? 0;
        const bank = memberData?.bank ?? 0;
        const total = wallet + bank;

        const embed = new EmbedBuilder()
            .setColor(0xffd700)
            .setTitle(`${currencySymbol} ${targetUser.username}'s Balance`)
            .setThumbnail(targetUser.displayAvatarURL())
            .addFields(
                { name: '💰 Wallet', value: `${wallet.toLocaleString()} ${currencyName}`, inline: true },
                { name: '🏦 Bank', value: `${bank.toLocaleString()} ${currencyName}`, inline: true },
                { name: '💎 Total', value: `${total.toLocaleString()} ${currencyName}`, inline: true },
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },
});
