import {
    SlashCommandBuilder,
    EmbedBuilder,
    GuildMember,
} from 'discord.js';
import { Command } from '../../types/Command.js';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('userinfo')
        .setDescription('Get information about a user')
        .addUserOption((option) =>
            option
                .setName('user')
                .setDescription('The user to get info about (defaults to yourself)')
        ),
    category: 'utility',
    cooldown: 5,
    guildOnly: true,

    async execute(interaction) {
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const member = interaction.guild!.members.cache.get(targetUser.id) as GuildMember | undefined;

        const badges = targetUser.flags?.toArray().map((flag) => {
            const badgeEmojis: Record<string, string> = {
                Staff: '👨‍💼',
                Partner: '🤝',
                Hypesquad: '🏠',
                BugHunterLevel1: '🐛',
                BugHunterLevel2: '🐛',
                HypeSquadOnlineHouse1: '🏠', // Bravery
                HypeSquadOnlineHouse2: '🏠', // Brilliance
                HypeSquadOnlineHouse3: '🏠', // Balance
                PremiumEarlySupporter: '⭐',
                VerifiedDeveloper: '👨‍💻',
                ActiveDeveloper: '🔧',
                VerifiedBot: '✅',
                CertifiedModerator: '🛡️',
            };
            return badgeEmojis[flag] || '';
        }).filter(Boolean).join(' ') || 'None';

        const embed = new EmbedBuilder()
            .setColor(member?.displayColor || 0x5865f2)
            .setTitle(`${targetUser.username}`)
            .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
            .addFields(
                { name: '🏷️ Tag', value: targetUser.tag, inline: true },
                { name: '🆔 ID', value: targetUser.id, inline: true },
                { name: '🤖 Bot', value: targetUser.bot ? 'Yes' : 'No', inline: true },
                { name: '📅 Account Created', value: `<t:${Math.floor(targetUser.createdTimestamp / 1000)}:R>`, inline: true },
                { name: '🎖️ Badges', value: badges, inline: true },
            );

        if (member) {
            const roles = member.roles.cache
                .filter((r) => r.id !== interaction.guildId)
                .sort((a, b) => b.position - a.position)
                .map((r) => r.toString())
                .slice(0, 10);

            embed.addFields(
                { name: '📥 Joined Server', value: member.joinedAt ? `<t:${Math.floor(member.joinedTimestamp! / 1000)}:R>` : 'Unknown', inline: true },
                { name: '📛 Nickname', value: member.nickname || 'None', inline: true },
                { name: '🎨 Display Color', value: member.displayHexColor, inline: true },
                { name: `📋 Roles (${member.roles.cache.size - 1})`, value: roles.length > 0 ? roles.join(', ') + (member.roles.cache.size > 11 ? '...' : '') : 'None' },
            );

            if (member.premiumSince) {
                embed.addFields({
                    name: '💎 Boosting Since',
                    value: `<t:${Math.floor(member.premiumSinceTimestamp! / 1000)}:R>`,
                    inline: true,
                });
            }
        }

        await interaction.reply({ embeds: [embed] });
    },
});
