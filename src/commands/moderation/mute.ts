import {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
    GuildMember,
} from 'discord.js';
import { Command } from '../../types/Command.js';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('mute')
        .setDescription('Timeout a user (prevent them from sending messages)')
        .addUserOption((option) =>
            option
                .setName('user')
                .setDescription('The user to timeout')
                .setRequired(true)
        )
        .addStringOption((option) =>
            option
                .setName('duration')
                .setDescription('Timeout duration (e.g., 5m, 1h, 1d, max 28d)')
                .setRequired(true)
        )
        .addStringOption((option) =>
            option
                .setName('reason')
                .setDescription('Reason for the timeout')
                .setMaxLength(500)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    category: 'moderation',
    cooldown: 3,
    guildOnly: true,
    requiredModule: 'moderation',

    async execute(interaction) {
        const targetUser = interaction.options.getUser('user', true);
        const durationStr = interaction.options.getString('duration', true);
        const reason = interaction.options.getString('reason') || 'No reason provided';
        const moderator = interaction.user;

        // Get guild member
        const targetMember = interaction.guild!.members.cache.get(targetUser.id) as GuildMember | undefined;

        if (!targetMember) {
            await interaction.reply({
                content: '❌ User not found in this server.',
                ephemeral: true,
            });
            return;
        }

        if (targetUser.id === interaction.user.id) {
            await interaction.reply({
                content: '❌ You cannot timeout yourself.',
                ephemeral: true,
            });
            return;
        }

        if (targetUser.bot) {
            await interaction.reply({
                content: '❌ You cannot timeout bots.',
                ephemeral: true,
            });
            return;
        }

        // Parse duration
        const durationMs = parseDuration(durationStr);
        if (!durationMs) {
            await interaction.reply({
                content: '❌ Invalid duration format. Use formats like: 5m, 1h, 1d, 7d (max 28d)',
                ephemeral: true,
            });
            return;
        }

        // Discord max timeout is 28 days
        const maxTimeout = 28 * 24 * 60 * 60 * 1000;
        if (durationMs > maxTimeout) {
            await interaction.reply({
                content: '❌ Maximum timeout duration is 28 days.',
                ephemeral: true,
            });
            return;
        }

        // Check role hierarchy
        const botMember = interaction.guild!.members.me;
        if (!botMember) {
            await interaction.reply({
                content: '❌ Could not verify bot permissions.',
                ephemeral: true,
            });
            return;
        }

        if (targetMember.roles.highest.position >= botMember.roles.highest.position) {
            await interaction.reply({
                content: '❌ I cannot timeout this user. Their role is higher than or equal to mine.',
                ephemeral: true,
            });
            return;
        }

        const executingMember = interaction.member as GuildMember;
        if (targetMember.roles.highest.position >= executingMember.roles.highest.position) {
            await interaction.reply({
                content: '❌ You cannot timeout this user. Their role is higher than or equal to yours.',
                ephemeral: true,
            });
            return;
        }

        if (!targetMember.moderatable) {
            await interaction.reply({
                content: '❌ I cannot timeout this user.',
                ephemeral: true,
            });
            return;
        }

        // Apply timeout
        await targetMember.timeout(durationMs, reason);

        const expiresAt = new Date(Date.now() + durationMs);

        // DM the user
        try {
            await targetUser.send({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xffcc00)
                        .setTitle(`🔇 You were timed out in ${interaction.guild!.name}`)
                        .addFields(
                            { name: 'Duration', value: durationStr },
                            { name: 'Expires', value: `<t:${Math.floor(expiresAt.getTime() / 1000)}:R>` },
                            { name: 'Reason', value: reason },
                        )
                        .setTimestamp(),
                ],
            });
        } catch {
            // User has DMs disabled
        }

        const embed = new EmbedBuilder()
            .setColor(0xffcc00)
            .setTitle('🔇 User Timed Out')
            .setThumbnail(targetUser.displayAvatarURL())
            .addFields(
                { name: 'User', value: `${targetUser.tag} (${targetUser.id})`, inline: true },
                { name: 'Moderator', value: moderator.tag, inline: true },
                { name: 'Duration', value: durationStr, inline: true },
                { name: 'Expires', value: `<t:${Math.floor(expiresAt.getTime() / 1000)}:R>`, inline: true },
                { name: 'Reason', value: reason },
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },
});

function parseDuration(duration: string): number | undefined {
    const match = duration.match(/^(\d+)(m|h|d|w)$/i);
    if (!match) return undefined;

    const value = parseInt(match[1]!, 10);
    const unit = match[2]!.toLowerCase();

    const multipliers: Record<string, number> = {
        m: 60 * 1000,           // minutes
        h: 60 * 60 * 1000,      // hours
        d: 24 * 60 * 60 * 1000, // days
        w: 7 * 24 * 60 * 60 * 1000, // weeks
    };

    return value * (multipliers[unit] || 0);
}
