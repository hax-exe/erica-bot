import {
    SlashCommandBuilder,
    EmbedBuilder,
} from 'discord.js';
import { Command } from '../../types/Command.js';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('serverinfo')
        .setDescription('Get information about the server'),
    category: 'utility',
    cooldown: 5,
    guildOnly: true,

    async execute(interaction) {
        const guild = interaction.guild!;

        await guild.members.fetch();

        const owner = await guild.fetchOwner();
        const channels = guild.channels.cache;
        const roles = guild.roles.cache;
        const emojis = guild.emojis.cache;

        const textChannels = channels.filter((c) => c.type === 0).size;
        const voiceChannels = channels.filter((c) => c.type === 2).size;
        const categories = channels.filter((c) => c.type === 4).size;

        const members = guild.members.cache;
        const humans = members.filter((m) => !m.user.bot).size;
        const bots = members.filter((m) => m.user.bot).size;

        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle(`${guild.name}`)
            .setThumbnail(guild.iconURL({ size: 256 }))
            .addFields(
                { name: '👑 Owner', value: `${owner.user.tag}`, inline: true },
                { name: '📅 Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
                { name: '🆔 ID', value: guild.id, inline: true },
                { name: '👥 Members', value: `${guild.memberCount} (${humans} humans, ${bots} bots)`, inline: true },
                { name: '💬 Channels', value: `${channels.size} (${textChannels} text, ${voiceChannels} voice, ${categories} categories)`, inline: true },
                { name: '🎭 Roles', value: `${roles.size}`, inline: true },
                { name: '😀 Emojis', value: `${emojis.size}`, inline: true },
                { name: '🚀 Boost Level', value: `Level ${guild.premiumTier} (${guild.premiumSubscriptionCount} boosts)`, inline: true },
            )
            .setTimestamp();

        if (guild.description) {
            embed.setDescription(guild.description);
        }

        if (guild.bannerURL()) {
            embed.setImage(guild.bannerURL({ size: 1024 }));
        }

        await interaction.reply({ embeds: [embed] });
    },
});
