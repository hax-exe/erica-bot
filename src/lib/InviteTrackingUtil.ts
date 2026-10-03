import { container } from '@sapphire/framework';
import {
	type ChatInputCommandInteraction,
	type Guild,
	type GuildMember,
	type InteractionEditReplyOptions,
	PermissionFlagsBits,
	TextDisplayBuilder,
} from 'discord.js';
import { and, asc, count, countDistinct, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { Colors, cv2Reply, errorReply, hint, makeContainer, pageNavRow } from './components.js';
import { db, schema } from './database.js';
import {
	countInviteRows,
	type InviteCounts,
	isFakeAccount,
	selectRewardRoleIds,
	type UsedInvite,
} from './InviteUtil.js';
import { isModuleEnabled } from './ModuleUtil.js';
import { fetchBotMember, unsafeGrantReason } from './RoleSafety.js';
import { isDuplicateKeyError } from './safe.js';

export const INVITE_LEADERBOARD_PAGE_SIZE = 10;
export const MAX_REWARD_INVITES = 10_000;
/** Custom ID prefix for the leaderboard Previous / Next buttons (`invites:lb:<page>`). */
export const INVITE_LEADERBOARD_PREFIX = 'invites:lb:';

export const INVITE_TRACKING_OFF_MESSAGE =
	'Invite Tracking is turned off in this server. Turn it on with `/module enable`.';

type InviteJoinRow = typeof schema.inviteJoins.$inferSelect;

// ─── Command guard ─────────────────────────────────────────────────────────────

/**
 * Shared by /invites and /invitesadmin: server-only + Invite Tracking module on.
 * Expects a deferred interaction. Returns the guild, or null after replying with an error.
 */
export async function requireInviteTracking(interaction: ChatInputCommandInteraction): Promise<Guild | null> {
	if (!interaction.inCachedGuild()) {
		await interaction.editReply(errorReply('This command can only be used in a server.'));
		return null;
	}
	if (!(await isModuleEnabled(interaction.guildId, 'inviteTracking'))) {
		await interaction.editReply(errorReply(INVITE_TRACKING_OFF_MESSAGE));
		return null;
	}
	return interaction.guild;
}

// ─── Join / leave records ──────────────────────────────────────────────────────

/** Record a join. Rows of an earlier stay whose leave was never seen (bot offline) are closed first. */
export async function recordInviteJoin(member: GuildMember, invite: UsedInvite | null): Promise<void> {
	const joinedAt = Date.now();
	await db
		.update(schema.inviteJoins)
		.set({ leftAt: joinedAt })
		.where(
			and(
				eq(schema.inviteJoins.guildId, member.guild.id),
				eq(schema.inviteJoins.userId, member.id),
				isNull(schema.inviteJoins.leftAt),
			),
		);
	await db.insert(schema.inviteJoins).values({
		guildId: member.guild.id,
		userId: member.id,
		inviterId: invite?.inviterId ?? null,
		inviteCode: invite?.code ?? null,
		joinedAt,
		fake: isFakeAccount(member.user.createdTimestamp, joinedAt),
	});
}

/** Set `left_at` on the member's latest open row. */
export async function markInviteLeft(guildId: string, userId: string): Promise<void> {
	const [open] = await db
		.select({ id: schema.inviteJoins.id })
		.from(schema.inviteJoins)
		.where(
			and(
				eq(schema.inviteJoins.guildId, guildId),
				eq(schema.inviteJoins.userId, userId),
				isNull(schema.inviteJoins.leftAt),
			),
		)
		.orderBy(desc(schema.inviteJoins.joinedAt), desc(schema.inviteJoins.id))
		.limit(1);
	if (!open) return;
	await db.update(schema.inviteJoins).set({ leftAt: Date.now() }).where(eq(schema.inviteJoins.id, open.id));
}

/** Latest join row for a user (who invited them), or null if no join was ever recorded. */
export async function getLatestJoin(guildId: string, userId: string): Promise<InviteJoinRow | null> {
	const [row] = await db
		.select()
		.from(schema.inviteJoins)
		.where(and(eq(schema.inviteJoins.guildId, guildId), eq(schema.inviteJoins.userId, userId)))
		.orderBy(desc(schema.inviteJoins.joinedAt), desc(schema.inviteJoins.id))
		.limit(1);
	return row ?? null;
}

// ─── Counts and leaderboard ────────────────────────────────────────────────────

/** An inviter's joins / left / fake / effective counts. */
export async function getInviterCounts(guildId: string, inviterId: string): Promise<InviteCounts> {
	const rows = await db
		.select({ leftAt: schema.inviteJoins.leftAt, fake: schema.inviteJoins.fake })
		.from(schema.inviteJoins)
		.where(and(eq(schema.inviteJoins.guildId, guildId), eq(schema.inviteJoins.inviterId, inviterId)));
	return countInviteRows(rows);
}

export interface InviteLeaderboardRow extends InviteCounts {
	inviterId: string;
}

/** SQL aggregates that mirror `countInviteRows` (keep the two in step). */
function leaderboardColumns() {
	const t = schema.inviteJoins;
	return {
		left: sql<number>`COALESCE(SUM(CASE WHEN ${t.leftAt} IS NOT NULL THEN 1 ELSE 0 END), 0)`.mapWith(Number),
		fake: sql<number>`COALESCE(SUM(CASE WHEN ${t.fake} = 1 THEN 1 ELSE 0 END), 0)`.mapWith(Number),
		effective: sql<number>`COALESCE(SUM(CASE WHEN ${t.leftAt} IS NULL AND ${t.fake} = 0 THEN 1 ELSE 0 END), 0)`.mapWith(
			Number,
		),
	};
}

/** Inviters with at least one effective invite, best first. `total` is the number of such inviters. */
export async function getInviteLeaderboard(
	guildId: string,
	limit: number,
	offset: number,
): Promise<{ rows: InviteLeaderboardRow[]; total: number }> {
	const t = schema.inviteJoins;
	const cols = leaderboardColumns();

	const rows = await db
		.select({ inviterId: t.inviterId, joins: count(), left: cols.left, fake: cols.fake, effective: cols.effective })
		.from(t)
		.where(and(eq(t.guildId, guildId), isNotNull(t.inviterId)))
		.groupBy(t.inviterId)
		.having(sql`${cols.effective} > 0`)
		.orderBy(desc(cols.effective), desc(count()), asc(t.inviterId))
		.limit(limit)
		.offset(offset);

	// An inviter has effective > 0 exactly when one of their rows is still open and not fake.
	const [totalRow] = await db
		.select({ n: countDistinct(t.inviterId) })
		.from(t)
		.where(and(eq(t.guildId, guildId), isNotNull(t.inviterId), isNull(t.leftAt), eq(t.fake, false)));

	return {
		rows: rows.map((r) => ({ ...r, inviterId: r.inviterId as string })),
		total: totalRow?.n ?? 0,
	};
}

/** One leaderboard page as a CV2 reply (ephemeral). Out-of-range pages are clamped. */
const RANK_MEDALS = ['🥇', '🥈', '🥉'];

/** Medal for the top three, `**N.**` below that. */
function rankLabel(rank: number): string {
	return RANK_MEDALS[rank - 1] ?? `**${rank}.**`;
}

export async function buildInviteLeaderboardPage(guildId: string, page: number): Promise<InteractionEditReplyOptions> {
	const first = await getInviteLeaderboard(
		guildId,
		INVITE_LEADERBOARD_PAGE_SIZE,
		Math.max(0, page) * INVITE_LEADERBOARD_PAGE_SIZE,
	);
	const totalPages = Math.max(1, Math.ceil(first.total / INVITE_LEADERBOARD_PAGE_SIZE));
	const clamped = Math.min(Math.max(0, page), totalPages - 1);
	const { rows } =
		clamped === page
			? first
			: await getInviteLeaderboard(guildId, INVITE_LEADERBOARD_PAGE_SIZE, clamped * INVITE_LEADERBOARD_PAGE_SIZE);

	const card = makeContainer({ color: Colors.Info, header: 'Invite Leaderboard' });
	if (rows.length === 0) {
		card.addTextDisplayComponents(new TextDisplayBuilder().setContent('No one has any invites yet.'));
		return cv2Reply(card, true);
	}

	const offset = clamped * INVITE_LEADERBOARD_PAGE_SIZE;
	const lines = rows.map(
		(r, i) =>
			`${rankLabel(offset + i + 1)} <@${r.inviterId}> · **${r.effective.toLocaleString()}** invite${r.effective === 1 ? '' : 's'}\n` +
			`-# ${r.joins.toLocaleString()} joins · ${r.left.toLocaleString()} left · ${r.fake.toLocaleString()} fake`,
	);
	card.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));

	card.addTextDisplayComponents(hint(`Page ${clamped + 1} of ${totalPages}`));
	if (totalPages > 1) {
		card.addActionRowComponents(
			pageNavRow(`${INVITE_LEADERBOARD_PREFIX}${clamped - 1}`, `${INVITE_LEADERBOARD_PREFIX}${clamped + 1}`, {
				atStart: clamped === 0,
				atEnd: clamped === totalPages - 1,
			}),
		);
	}
	return cv2Reply(card, true);
}

// ─── Rewards ───────────────────────────────────────────────────────────────────

export async function listInviteRewards(guildId: string) {
	return db
		.select({ id: schema.inviteRewards.id, invites: schema.inviteRewards.invites, roleId: schema.inviteRewards.roleId })
		.from(schema.inviteRewards)
		.where(eq(schema.inviteRewards.guildId, guildId))
		.orderBy(asc(schema.inviteRewards.invites), asc(schema.inviteRewards.id));
}

/** Returns false when this invites/role pair already exists. */
export async function addInviteReward(guildId: string, invites: number, roleId: string): Promise<boolean> {
	try {
		await db.insert(schema.inviteRewards).values({ guildId, invites, roleId });
		return true;
	} catch (err) {
		if (isDuplicateKeyError(err)) return false;
		throw err;
	}
}

/** Returns false when no such reward existed. */
export async function removeInviteReward(guildId: string, invites: number, roleId: string): Promise<boolean> {
	const result = await db
		.delete(schema.inviteRewards)
		.where(
			and(
				eq(schema.inviteRewards.guildId, guildId),
				eq(schema.inviteRewards.invites, invites),
				eq(schema.inviteRewards.roleId, roleId),
			),
		);
	return Number((result as any)[0]?.affectedRows ?? 0) > 0;
}

/** Warn about an unsafe reward role at most once per guild + role per hour. */
const UNSAFE_REWARD_WARN_INTERVAL_MS = 60 * 60_000;
const MAX_UNSAFE_REWARD_WARNINGS = 1_000;
const unsafeRewardWarnedAt = new Map<string, number>();

function shouldWarnUnsafeReward(guildId: string, roleId: string, now = Date.now()): boolean {
	const key = `${guildId}:${roleId}`;
	const last = unsafeRewardWarnedAt.get(key);
	if (last !== undefined && now - last < UNSAFE_REWARD_WARN_INTERVAL_MS) return false;

	unsafeRewardWarnedAt.delete(key);
	unsafeRewardWarnedAt.set(key, now);
	if (unsafeRewardWarnedAt.size > MAX_UNSAFE_REWARD_WARNINGS) {
		for (const [k, at] of unsafeRewardWarnedAt) {
			if (now - at >= UNSAFE_REWARD_WARN_INTERVAL_MS) unsafeRewardWarnedAt.delete(k);
		}
		// Still full: drop the oldest entries (Map iteration is insertion order).
		for (const k of unsafeRewardWarnedAt.keys()) {
			if (unsafeRewardWarnedAt.size <= MAX_UNSAFE_REWARD_WARNINGS) break;
			unsafeRewardWarnedAt.delete(k);
		}
	}
	return true;
}

/**
 * Grant every reward role the inviter has earned and does not hold yet. Skips inviters who have
 * left the server. Each role is re-checked first (RoleSafety): one that has since gained staff
 * permissions or moved above the bot is skipped with a warning (at most hourly per role). Role
 * errors are swallowed (a missing permission must never break a join).
 */
export async function grantInviteRewards(guild: Guild, inviterId: string): Promise<void> {
	const rewards = await listInviteRewards(guild.id);
	if (rewards.length === 0) return;

	const me = await fetchBotMember(guild);
	if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) return;

	const inviter = await guild.members.fetch(inviterId).catch(() => null);
	if (!inviter) return;

	const { effective } = await getInviterCounts(guild.id, inviterId);
	const roleIds = selectRewardRoleIds(effective, rewards, (id) => inviter.roles.cache.has(id)).filter((id) => {
		const role = guild.roles.cache.get(id);
		if (!role) return false;
		const unsafe = unsafeGrantReason(role, me);
		if (unsafe && shouldWarnUnsafeReward(guild.id, id)) {
			container.logger.warn(`[invites] Skipping an invite reward role in ${guild.id}: ${unsafe}`);
		}
		return !unsafe;
	});

	// One PUT per role, so a reward never overwrites a role change made at the same moment.
	for (const roleId of roleIds) {
		await inviter.roles.add(roleId, 'Invite reward').catch((err: unknown) => {
			container.logger.debug(`[invites] could not grant reward role ${roleId} to ${inviterId} in ${guild.id}:`, err);
		});
	}
}

// ─── Admin ─────────────────────────────────────────────────────────────────────

/** Delete every join row credited to this inviter. Returns how many rows were removed. */
export async function resetInviter(guildId: string, inviterId: string): Promise<number> {
	const result = await db
		.delete(schema.inviteJoins)
		.where(and(eq(schema.inviteJoins.guildId, guildId), eq(schema.inviteJoins.inviterId, inviterId)));
	return Number((result as any)[0]?.affectedRows ?? 0);
}
