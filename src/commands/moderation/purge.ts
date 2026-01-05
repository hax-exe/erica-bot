import {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
    TextChannel,
    Collection,
    Message,
} from 'discord.js';
import { Command } from '../../types/Command.js';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('purge')
        .setDescription('Bulk delete messages from a channel')
        .addIntegerOption((option) =>
            option
                .setName('amount')
                .setDescription('Number of messages to delete (1-100)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(100)
        )
        .addUserOption((option) =>
            option
                .setName('user')
                .setDescription('Only delete messages from this user')
        )
        .addStringOption((option) =>
            option
                .setName('contains')
                .setDescription('Only delete messages containing this text')
        )
        .addBooleanOption((option) =>
            option
                .setName('bots')
                .setDescription('Only delete messages from bots')
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    category: 'moderation',
    cooldown: 5,
    guildOnly: true,
    requiredModule: 'moderation',

    async execute(interaction) {
        const amount = interaction.options.getInteger('amount', true);
        const targetUser = interaction.options.getUser('user');
        const containsText = interaction.options.getString('contains');
        const botsOnly = interaction.options.getBoolean('bots');

        const channel = interaction.channel as TextChannel;

        if (!channel || !('bulkDelete' in channel)) {
            await interaction.reply({
                content: '❌ Cannot delete messages in this channel type.',
                ephemeral: true,
            });
            return;
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            // Fetch messages
            let messages: Collection<string, Message> = await channel.messages.fetch({
                limit: Math.min(amount + 1, 100) // +1 to account for potential filtering
            });

            // Filter out the interaction reply if it exists
            messages = messages.filter((m) => m.id !== interaction.id);

            // Apply filters
            if (targetUser) {
                messages = messages.filter((m) => m.author.id === targetUser.id);
            }

            if (containsText) {
                const searchText = containsText.toLowerCase();
                messages = messages.filter((m) =>
                    m.content.toLowerCase().includes(searchText)
                );
            }

            if (botsOnly) {
                messages = messages.filter((m) => m.author.bot);
            }

            // Limit to requested amount
            const toDelete = messages.first(amount);

            if (toDelete.length === 0) {
                await interaction.editReply('❌ No messages found matching the criteria.');
                return;
            }

            // Filter out messages older than 14 days (Discord limitation)
            const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
            const deletableMessages = toDelete.filter(
                (m) => m.createdTimestamp > twoWeeksAgo
            );

            if (deletableMessages.length === 0) {
                await interaction.editReply('❌ All matching messages are older than 14 days and cannot be bulk deleted.');
                return;
            }

            // Delete messages
            const deleted = await channel.bulkDelete(deletableMessages, true);

            const embed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle('🗑️ Messages Purged')
                .setDescription(`Successfully deleted **${deleted.size}** message(s).`)
                .addFields(
                    { name: 'Channel', value: `${channel}`, inline: true },
                    { name: 'Moderator', value: interaction.user.tag, inline: true },
                )
                .setTimestamp();

            if (targetUser) {
                embed.addFields({ name: 'User Filter', value: targetUser.tag, inline: true });
            }
            if (containsText) {
                embed.addFields({ name: 'Text Filter', value: containsText, inline: true });
            }
            if (botsOnly) {
                embed.addFields({ name: 'Bots Only', value: 'Yes', inline: true });
            }

            await interaction.editReply({ embeds: [embed] });
        } catch {
            await interaction.editReply('❌ Failed to delete messages. They may be older than 14 days.');
        }
    },
});
