import { AttachmentBuilder } from 'discord.js';
import { pageNavRow } from './components.js';
import { getLeaderboard, getTotalLeaderboardEntries, levelFromTotalXp } from './LevelingUtil.js';
import { type LeaderboardEntry, renderLeaderboard } from './RankCardUtil.js';

export async function buildLeaderboardPage(
	guildId: string,
	guildName: string,
	limit: number,
	page: number,
	client: any,
) {
	const offset = page * limit;
	const rows = await getLeaderboard(guildId, limit, offset);

	if (rows.length === 0 && page === 0) {
		return { files: [], content: 'No one has earned any XP yet.' };
	} else if (rows.length === 0) {
		return { files: [], content: 'No more entries on this page.' };
	}

	const totalEntries = await getTotalLeaderboardEntries(guildId);
	const totalPages = Math.ceil(totalEntries / limit) || 1;

	const entries: LeaderboardEntry[] = await Promise.all(
		rows.map(async (row, i) => {
			const guild = client.guilds.cache.get(guildId);
			const member = await guild?.members.fetch(row.userId).catch(() => null);
			const { level, currentXp, xpNeeded } = levelFromTotalXp(row.totalXp);
			const defaultAvatarNum = Number((BigInt(row.userId) >> BigInt(22)) % BigInt(6));
			return {
				rank: offset + i + 1,
				userId: row.userId,
				displayName: member?.displayName ?? row.userId,
				avatarURL:
					member?.user.displayAvatarURL({ size: 64, extension: 'png' }) ??
					`https://cdn.discordapp.com/embed/avatars/${defaultAvatarNum}.png`,
				level,
				totalXp: row.totalXp,
				currentXp,
				xpNeeded,
			};
		}),
	);

	const buffer = await renderLeaderboard(entries, guildName);
	const attachment = new AttachmentBuilder(buffer, { name: 'leaderboard.png' });

	const payload: { files: AttachmentBuilder[]; components: ReturnType<typeof pageNavRow>[]; content?: string } = {
		files: [attachment],
		components: [],
	};

	if (totalPages > 1) {
		payload.components = [
			pageNavRow(`page:leaderboard:${limit}:${page - 1}`, `page:leaderboard:${limit}:${page + 1}`, {
				atStart: page === 0,
				atEnd: page === totalPages - 1,
			}),
		];
	}

	return payload;
}
