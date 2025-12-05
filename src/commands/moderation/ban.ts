import {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
    GuildMember,
} from 'discord.js';
import { Command } from '../../types/Command.js';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Ban a user from the server')
        .addUserOption((option) =>
            option
                .setName('user')
                .setDescription('The user to ban')
                .setRequired(true)
        )
        .addStringOption((option) =>
            option
                .setName('reason')
                .setDescription('Reason for the ban')
                .setMaxLength(500)
        )
        .addIntegerOption((option) =>
            option
                .setName('delete_days')
                .setDescription('Number of days of messages to delete (0-7)')
                .setMinValue(0)
                .setMaxValue(7)
        )
        .addStringOption((option) =>
            option
                .setName('duration')
                .setDescription('Temporary ban duration (e.g., 1h, 1d, 7d)')
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    category: 'moderation',
    cooldown: 3,
    guildOnly: true,
    requiredModule: 'moderation',

    async execute(interaction) {
        const targetUser = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason') || 'No reason provided';
        const deleteDays = interaction.options.getInteger('delete_days') || 0;
        const duration = interaction.options.getString('duration');
        const moderator = interaction.user;

        if (targetUser.id === interaction.user.id) {
            await interaction.reply({
                content: '❌ You cannot ban yourself.',
                ephemeral: true,
            });
            return;
        }

        if (targetUser.id === interaction.client.user?.id) {
            await interaction.reply({
                content: '❌ I cannot ban myself.',
                ephemeral: true,
            });
            return;
        }

        // Get guild member (may be null if user is not in server)
        const targetMember = interaction.guild!.members.cache.get(targetUser.id) as GuildMember | undefined;
        const botMember = interaction.guild!.members.me;
        const executingMember = interaction.member as GuildMember;

        if (!botMember) {
            await interaction.reply({
                content: '❌ Could not verify bot permissions.',
                ephemeral: true,
            });
            return;
        }

        // Check role hierarchy if member is in server
        if (targetMember) {
            if (targetMember.roles.highest.position >= botMember.roles.highest.position) {
                await interaction.reply({
                    content: '❌ I cannot ban this user. Their role is higher than or equal to mine.',
                    ephemeral: true,
                });
                return;
            }

            if (targetMember.roles.highest.position >= executingMember.roles.highest.position) {
                await interaction.reply({
                    content: '❌ You cannot ban this user. Their role is higher than or equal to yours.',
                    ephemeral: true,
                });
                return;
            }

            if (!targetMember.bannable) {
                await interaction.reply({
                    content: '❌ I cannot ban this user.',
                    ephemeral: true,
                });
                return;
            }
        }

        // Parse duration if provided
        let durationMs: number | undefined;
        let durationText = 'Permanent';
        if (duration) {
            durationMs = parseDuration(duration);
            if (!durationMs) {
                await interaction.reply({
                    content: '❌ Invalid duration format. Use formats like: 1h, 1d, 7d, 30d',
                    ephemeral: true,
                });
                return;
            }
            durationText = duration;
        }

        // DM the user before banning
        try {
            await targetUser.send({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xff0000)
                        .setTitle(`🔨 You were banned from ${interaction.guild!.name}`)
                        .addFields(
                            { name: 'Reason', value: reason },
                            { name: 'Duration', value: durationText },
                        )
                        .setTimestamp(),
                ],
            });
        } catch {
            // User has DMs disabled
        }

        // Ban the user
        await interaction.guild!.members.ban(targetUser, {
            reason: `${reason} | Banned by ${moderator.tag}`,
            deleteMessageSeconds: deleteDays * 24 * 60 * 60,
        });

        const embed = new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle('🔨 User Banned')
            .setThumbnail(targetUser.displayAvatarURL())
            .addFields(
                { name: 'User', value: `${targetUser.tag} (${targetUser.id})`, inline: true },
                { name: 'Moderator', value: moderator.tag, inline: true },
                { name: 'Duration', value: durationText, inline: true },
                { name: 'Messages Deleted', value: `${deleteDays} day(s)`, inline: true },
                { name: 'Reason', value: reason },
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });

        // TODO: Schedule unban for temporary bans using a job scheduler
        // For now, temp bans would need manual implementation with a scheduler like node-cron
    },
});

function parseDuration(duration: string): number | undefined {
    const match = duration.match(/^(\d+)(h|d|w|m)$/i);
    if (!match) return undefined;

    const value = parseInt(match[1]!, 10);
    const unit = match[2]!.toLowerCase();

    const multipliers: Record<string, number> = {
        h: 60 * 60 * 1000,      // hours
        d: 24 * 60 * 60 * 1000, // days
        w: 7 * 24 * 60 * 60 * 1000, // weeks
        m: 30 * 24 * 60 * 60 * 1000, // months (approximate)
    };

    return value * (multipliers[unit] || 0);
}
