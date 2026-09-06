import type { Guild } from 'discord.js';
import { and, avg, count, eq, isNotNull } from 'drizzle-orm';
import { db, schema } from './database.js';
import { formatDuration } from './TicketStatsUtil.js';
import { getTicketSettingsFromConfig } from './TicketsConfig.js';

/** Rename configured support-status voice channels for a guild (from tickets.yml). */
export async function updateTicketStatsChannels(guild: Guild): Promise<void> {
	const settings = getTicketSettingsFromConfig(guild.id);
	const cfg = settings?.statusChannels;
	if (!cfg) return;
	if (!cfg.openTicketsChannelId && !cfg.totalTicketsChannelId && !cfg.avgRatingChannelId && !cfg.avgTimeChannelId) {
		return;
	}

	const [openRow] = await db
		.select({ value: count() })
		.from(schema.tickets)
		.where(and(eq(schema.tickets.guildId, guild.id), eq(schema.tickets.status, 'open')));

	const [totalRow] = await db
		.select({ value: count() })
		.from(schema.tickets)
		.where(eq(schema.tickets.guildId, guild.id));

	const [ratingRow] = await db
		.select({ value: avg(schema.ticketReviews.rating) })
		.from(schema.ticketReviews)
		.where(eq(schema.ticketReviews.guildId, guild.id));

	const closed = await db
		.select({
			createdAt: schema.tickets.createdAt,
			closedAt: schema.tickets.closedAt,
		})
		.from(schema.tickets)
		.where(
			and(
				eq(schema.tickets.guildId, guild.id),
				eq(schema.tickets.status, 'closed'),
				isNotNull(schema.tickets.closedAt),
			),
		);

	const closeMs = closed
		.map((r) => {
			if (!r.closedAt) return null;
			const a = r.createdAt.getTime();
			const b = r.closedAt.getTime();
			if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
			return b - a;
		})
		.filter((n): n is number => n != null);

	const avgCloseMs = closeMs.length ? closeMs.reduce((a, b) => a + b, 0) / closeMs.length : null;
	const avgRating = ratingRow?.value != null ? Number(ratingRow.value) : null;

	const openName = `Open Tickets: ${Number(openRow?.value ?? 0)}`;
	const totalName = `Total Tickets: ${Number(totalRow?.value ?? 0)}`;
	const ratedName =
		avgRating != null && Number.isFinite(avgRating) ? `Rated ⭐ ${avgRating.toFixed(2)} /5` : 'Rated ⭐ — /5';
	const avgTimeName = `Avg Time: ${formatAvgTimeLabel(avgCloseMs)}`;

	const updates: Array<[string | null | undefined, string]> = [
		[cfg.openTicketsChannelId, openName],
		[cfg.totalTicketsChannelId, totalName],
		[cfg.avgRatingChannelId, ratedName],
		[cfg.avgTimeChannelId, avgTimeName],
	];

	for (const [channelId, name] of updates) {
		if (!channelId) continue;
		const channel = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
		if (!channel || !('setName' in channel)) continue;
		if (channel.name === name) continue;
		await channel.setName(name).catch(() => null);
	}
}

function formatAvgTimeLabel(ms: number | null): string {
	if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
	const mins = Math.round(ms / 60_000);
	if (mins < 1) return '<1 Min';
	if (mins === 1) return '1 Min';
	if (mins < 60) return `${mins} Mins`;
	return formatDuration(ms);
}

/** Fire-and-forget refresh; safe to call after ticket/review changes. */
export function scheduleTicketStatsChannelUpdate(guild: Guild): void {
	void updateTicketStatsChannels(guild).catch(() => null);
}
