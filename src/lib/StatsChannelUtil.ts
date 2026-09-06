import type { Guild } from 'discord.js';
import { eq } from 'drizzle-orm';
import { db, schema } from './database.js';

/** Updates all configured stats voice channels for a guild. */
export async function updateStatsChannels(guild: Guild): Promise<void> {
	const cfg = await db.query.statsChannels.findFirst({
		where: eq(schema.statsChannels.guildId, guild.id),
	});
	if (!cfg) return;

	const members = await guild.members.fetch().catch(() => guild.members.cache);
	const totalMembers = members.filter((m) => !m.user.bot).size;
	const onlineMembers = members.filter(
		(m) => !m.user.bot && m.presence?.status != null && m.presence.status !== 'offline',
	).size;
	const botCount = members.filter((m) => m.user.bot).size;
	const channelCount = guild.channels.cache.filter((c) => !c.isThread()).size;

	const updates: Array<[string | null | undefined, string]> = [
		[cfg.memberCountChannelId, `👥 Members: ${totalMembers.toLocaleString()}`],
		[cfg.onlineCountChannelId, `🟢 Online: ${onlineMembers.toLocaleString()}`],
		[cfg.botCountChannelId, `🤖 Bots: ${botCount.toLocaleString()}`],
		[cfg.channelCountChannelId, `📢 Channels: ${channelCount.toLocaleString()}`],
	];

	for (const [channelId, name] of updates) {
		if (!channelId) continue;
		const channel = guild.channels.cache.get(channelId);
		if (!channel) continue;
		if (channel.name === name) continue;
		await channel.setName(name).catch(() => null);
	}
}
