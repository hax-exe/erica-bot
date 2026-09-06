import { and, count, eq, gte, isNotNull } from 'drizzle-orm';
import { db, schema } from './database.js';

export type TicketStatsTimeframe = '7d' | '30d' | 'all';

export type GuildTicketStats = {
	openTickets: number;
	closedTickets: number;
	avgCloseMs: number | null;
	reviewCount: number;
	avgRating: number | null;
	ratingCounts: Record<1 | 2 | 3 | 4 | 5, number>;
};

export type StaffTicketStats = {
	staffId: string;
	closedCount: number;
	claimedCount: number;
	avgCloseMs: number | null;
	reviewCount: number;
	avgRating: number | null;
};

function timeframeDate(tf: TicketStatsTimeframe): Date | null {
	if (tf === '7d') return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
	if (tf === '30d') return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
	return null;
}

export function timeframeLabel(tf: TicketStatsTimeframe): string {
	if (tf === '7d') return 'Past 7 days';
	if (tf === '30d') return 'Past 30 days';
	return 'All time';
}

/** Human-readable duration from milliseconds. */
export function formatDuration(ms: number | null | undefined): string {
	if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
	const totalMin = Math.round(ms / 60_000);
	if (totalMin < 1) return '<1m';
	if (totalMin < 60) return `${totalMin}m`;
	const hours = Math.floor(totalMin / 60);
	const mins = totalMin % 60;
	if (hours < 48) return mins ? `${hours}h ${mins}m` : `${hours}h`;
	const days = Math.floor(hours / 24);
	const remH = hours % 24;
	return remH ? `${days}d ${remH}h` : `${days}d`;
}

function toMs(createdAt: Date | string | number, closedAt: Date | string | number): number | null {
	const a = createdAt instanceof Date ? createdAt.getTime() : new Date(createdAt).getTime();
	const b = closedAt instanceof Date ? closedAt.getTime() : new Date(closedAt).getTime();
	if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
	return b - a;
}

/** Staff attribution: claimed handler, else closer (not opener). */
export function attributeStaff(ticket: {
	userId: string;
	claimedById: string | null;
	closedById: string | null;
}): string | null {
	if (ticket.claimedById) return ticket.claimedById;
	if (ticket.closedById && ticket.closedById !== ticket.userId) return ticket.closedById;
	return null;
}

export async function getGuildTicketStats(
	guildId: string,
	timeframe: TicketStatsTimeframe,
	botUserId?: string | null,
): Promise<GuildTicketStats> {
	const since = timeframeDate(timeframe);

	const openTickets = await db
		.select({ value: count() })
		.from(schema.tickets)
		.where(and(eq(schema.tickets.guildId, guildId), eq(schema.tickets.status, 'open')))
		.then((r) => Number(r[0]?.value ?? 0));

	const closedConds = [
		eq(schema.tickets.guildId, guildId),
		eq(schema.tickets.status, 'closed'),
		isNotNull(schema.tickets.closedAt),
	];
	if (since) closedConds.push(gte(schema.tickets.closedAt, since));

	const closedRows = await db
		.select({
			createdAt: schema.tickets.createdAt,
			closedAt: schema.tickets.closedAt,
			userId: schema.tickets.userId,
			closedById: schema.tickets.closedById,
		})
		.from(schema.tickets)
		.where(and(...closedConds));

	const closedTickets = closedRows.filter((r) => !botUserId || r.closedById !== botUserId).length;

	const closeMs = closedRows
		.map((r) => (r.closedAt ? toMs(r.createdAt, r.closedAt) : null))
		.filter((n): n is number => n != null);
	const avgCloseMs = closeMs.length ? closeMs.reduce((a, b) => a + b, 0) / closeMs.length : null;

	const reviewConds = [eq(schema.ticketReviews.guildId, guildId)];
	if (since) reviewConds.push(gte(schema.ticketReviews.createdAt, since));

	const reviews = await db
		.select({ rating: schema.ticketReviews.rating })
		.from(schema.ticketReviews)
		.where(and(...reviewConds));

	const ratingCounts: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
	let ratingSum = 0;
	for (const r of reviews) {
		const rating = Math.min(5, Math.max(1, Math.round(r.rating))) as 1 | 2 | 3 | 4 | 5;
		ratingCounts[rating]++;
		ratingSum += r.rating;
	}

	return {
		openTickets,
		closedTickets,
		avgCloseMs,
		reviewCount: reviews.length,
		avgRating: reviews.length ? ratingSum / reviews.length : null,
		ratingCounts,
	};
}

export async function getStaffTicketStats(
	guildId: string,
	timeframe: TicketStatsTimeframe,
	botUserId?: string | null,
	limit = 15,
): Promise<StaffTicketStats[]> {
	const since = timeframeDate(timeframe);

	const closedConds = [eq(schema.tickets.guildId, guildId), eq(schema.tickets.status, 'closed')];
	if (since) closedConds.push(gte(schema.tickets.closedAt, since));

	const tickets = await db
		.select({
			id: schema.tickets.id,
			userId: schema.tickets.userId,
			claimedById: schema.tickets.claimedById,
			closedById: schema.tickets.closedById,
			createdAt: schema.tickets.createdAt,
			closedAt: schema.tickets.closedAt,
		})
		.from(schema.tickets)
		.where(and(...closedConds));

	const reviewConds = [eq(schema.ticketReviews.guildId, guildId)];
	if (since) reviewConds.push(gte(schema.ticketReviews.createdAt, since));

	const reviews = await db
		.select({
			ticketId: schema.ticketReviews.ticketId,
			rating: schema.ticketReviews.rating,
		})
		.from(schema.ticketReviews)
		.where(and(...reviewConds));

	const reviewByTicket = new Map(reviews.map((r) => [r.ticketId, r.rating]));

	type Acc = {
		closedCount: number;
		claimedCount: number;
		closeMsTotal: number;
		closeMsN: number;
		ratingTotal: number;
		ratingN: number;
	};
	const byStaff = new Map<string, Acc>();

	const bump = (staffId: string): Acc => {
		let acc = byStaff.get(staffId);
		if (!acc) {
			acc = { closedCount: 0, claimedCount: 0, closeMsTotal: 0, closeMsN: 0, ratingTotal: 0, ratingN: 0 };
			byStaff.set(staffId, acc);
		}
		return acc;
	};

	for (const ticket of tickets) {
		if (botUserId && ticket.closedById === botUserId) continue;
		const staffId = attributeStaff(ticket);
		if (!staffId || (botUserId && staffId === botUserId)) continue;

		const acc = bump(staffId);
		acc.closedCount++;
		if (ticket.claimedById === staffId) acc.claimedCount++;

		if (ticket.closedAt) {
			const ms = toMs(ticket.createdAt, ticket.closedAt);
			if (ms != null) {
				acc.closeMsTotal += ms;
				acc.closeMsN++;
			}
		}

		const rating = reviewByTicket.get(ticket.id);
		if (rating != null) {
			acc.ratingTotal += rating;
			acc.ratingN++;
		}
	}

	return [...byStaff.entries()]
		.map(([staffId, acc]) => ({
			staffId,
			closedCount: acc.closedCount,
			claimedCount: acc.claimedCount,
			avgCloseMs: acc.closeMsN ? acc.closeMsTotal / acc.closeMsN : null,
			reviewCount: acc.ratingN,
			avgRating: acc.ratingN ? acc.ratingTotal / acc.ratingN : null,
		}))
		.sort((a, b) => b.closedCount - a.closedCount || (b.avgRating ?? 0) - (a.avgRating ?? 0))
		.slice(0, limit);
}

export async function getStaffMemberTicketStats(
	guildId: string,
	staffId: string,
	timeframe: TicketStatsTimeframe,
): Promise<StaffTicketStats> {
	const all = await getStaffTicketStats(guildId, timeframe, null, 10_000);
	return (
		all.find((s) => s.staffId === staffId) ?? {
			staffId,
			closedCount: 0,
			claimedCount: 0,
			avgCloseMs: null,
			reviewCount: 0,
			avgRating: null,
		}
	);
}
