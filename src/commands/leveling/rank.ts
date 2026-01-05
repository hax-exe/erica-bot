import {
    SlashCommandBuilder,
    AttachmentBuilder,
} from 'discord.js';
import { Command } from '../../types/Command.js';
import { db } from '../../db/index.js';
import { guildMembers } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { getXpProgress } from '../../services/leveling.js';
import { generateRankCard } from '../../utils/rankCard.js';
import { getActiveBackgroundId, fetchBackgroundImage } from '../../utils/cloudStorage.js';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('rank')
        .setDescription('View your or another user\'s rank')
        .addUserOption((option) =>
            option
                .setName('user')
                .setDescription('The user to check (defaults to yourself)')
        ),
    category: 'leveling',
    cooldown: 5,
    guildOnly: true,
    requiredModule: 'leveling',

    async execute(interaction, _client) {
        const targetUser = interaction.options.getUser('user') || interaction.user;

        await interaction.deferReply();

        // Get member data
        const memberData = await db.query.guildMembers.findFirst({
            where: and(
                eq(guildMembers.guildId, interaction.guildId!),
                eq(guildMembers.odId, targetUser.id)
            ),
        });

        const xp = memberData?.xp ?? 0;
        const level = memberData?.level ?? 0;
        const progress = getXpProgress(xp);

        // Get rank position
        const allMembers = await db.query.guildMembers.findMany({
            where: eq(guildMembers.guildId, interaction.guildId!),
            orderBy: (m, { desc }) => [desc(m.xp)],
        });

        const rank = allMembers.findIndex((m) => m.odId === targetUser.id) + 1;

        // Fetch guild's active background from S3 (if any)
        let backgroundBuffer: Buffer | undefined;
        const backgroundId = await getActiveBackgroundId(interaction.guildId!);
        if (backgroundId) {
            const buffer = await fetchBackgroundImage(backgroundId);
            if (buffer) {
                backgroundBuffer = buffer;
            }
        }

        // Generate rank card image
        const rankCardBuffer = await generateRankCard({
            username: targetUser.username,
            avatarUrl: targetUser.displayAvatarURL({ extension: 'png', size: 256 }),
            rank: rank || 0,
            level: level,
            currentXp: progress.current,
            requiredXp: progress.required,
            totalXp: xp,
            ...(backgroundBuffer ? { backgroundBuffer } : {}),
        });

        const attachment = new AttachmentBuilder(rankCardBuffer, { name: 'rank.png' });
        await interaction.editReply({ files: [attachment] });
    },
});
