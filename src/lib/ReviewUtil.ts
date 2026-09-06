import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ContainerBuilder,
	type Guild,
	SectionBuilder,
	TextDisplayBuilder,
	ThumbnailBuilder,
	type User,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { Colors, CV2_FLAG, makeContainer, separator } from './components.js';
import { db, schema } from './database.js';

// ─── Custom ID constants ───────────────────────────────────────────────────────

/** Prefix for review rating buttons. Full ID: `review:btn:{rating}:{ticketId}:{guildId}` */
export const REVIEW_BTN_PREFIX = 'review:btn:';
/** Prefix for review modal. Full ID: `review:modal:{rating}:{ticketId}:{guildId}` */
export const REVIEW_MODAL_PREFIX = 'review:modal:';

export const STARS = ['', '⭐', '⭐⭐', '⭐⭐⭐', '⭐⭐⭐⭐', '⭐⭐⭐⭐⭐'] as const;

// ─── DB helpers ────────────────────────────────────────────────────────────────

export type ReviewSettings = typeof schema.reviewSettings.$inferSelect;

export async function getReviewSettings(guildId: string): Promise<ReviewSettings | null> {
	return db
		.select()
		.from(schema.reviewSettings)
		.where(eq(schema.reviewSettings.guildId, guildId))
		.limit(1)
		.then((r) => r[0] ?? null);
}

export async function upsertReviewSettings(
	guildId: string,
	patch: Partial<typeof schema.reviewSettings.$inferInsert>,
): Promise<void> {
	await db
		.insert(schema.reviewSettings)
		.values({ guildId, ...patch })
		.onDuplicateKeyUpdate({ set: patch });
}

/** Returns true if a review has already been submitted for this ticket. */
export async function hasReview(ticketId: number): Promise<boolean> {
	const row = await db
		.select()
		.from(schema.ticketReviews)
		.where(eq(schema.ticketReviews.ticketId, ticketId))
		.limit(1)
		.then((r) => r[0] ?? null);
	return row !== null;
}

/** Saves a review to the DB and returns the inserted row. */
export async function saveReview(
	ticketId: number,
	guildId: string,
	userId: string,
	rating: number,
	comment: string | null,
): Promise<typeof schema.ticketReviews.$inferSelect | null> {
	const existing = await db
		.select()
		.from(schema.ticketReviews)
		.where(eq(schema.ticketReviews.ticketId, ticketId))
		.limit(1)
		.then((r) => r[0] ?? null);
	if (existing) return null;

	const [idRow] = await db
		.insert(schema.ticketReviews)
		.values({ ticketId, guildId, userId, rating, comment: comment || null })
		.$returningId();
	const [row] = await db.select().from(schema.ticketReviews).where(eq(schema.ticketReviews.id, idRow.id)).limit(1);
	return row ?? null;
}

// ─── DM review request ─────────────────────────────────────────────────────────

/** Build the DM message asking the user to rate their ticket experience. */
export function buildReviewRequestDM(
	ticketId: number,
	categoryLabel: string,
	guildName: string,
	guildId: string,
): { components: ContainerBuilder[]; flags: number } {
	const container = makeContainer({ color: Colors.Info, header: 'Rate Your Support Experience' });
	container.addTextDisplayComponents(
		new TextDisplayBuilder().setContent(
			`Your ticket in **${guildName}** (Category: **${categoryLabel}**) has been closed.\nHow would you rate the support you received?`,
		),
	);
	container.addSeparatorComponents(separator());

	// 5 star buttons in one row
	const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
		...[1, 2, 3, 4, 5].map((n) =>
			new ButtonBuilder()
				.setCustomId(`${REVIEW_BTN_PREFIX}${n}:${ticketId}:${guildId}`)
				.setLabel(`${n} ${'⭐'.repeat(n)}`)
				.setStyle(ButtonStyle.Secondary),
		),
	);
	container.addActionRowComponents(row);

	return { components: [container], flags: CV2_FLAG };
}

// ─── Review post ───────────────────────────────────────────────────────────────

/** Build the CV2 container posted to the reviews channel. */
export function buildReviewPost(
	ticketId: number,
	categoryLabel: string,
	reviewer: User,
	rating: number,
	comment: string | null,
): ContainerBuilder {
	const starColor = rating >= 4 ? Colors.Success : rating === 3 ? Colors.Warning : Colors.Error;
	const container = new ContainerBuilder().setAccentColor(starColor);

	// Section: text on the left, reviewer's avatar on the right
	const section = new SectionBuilder()
		.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`### ${STARS[rating]} ${rating}/5\n**Ticket #${ticketId}** — ${categoryLabel}`,
			),
		)
		.setThumbnailAccessory(new ThumbnailBuilder().setURL(reviewer.displayAvatarURL({ size: 64, extension: 'png' })));
	container.addSectionComponents(section);

	if (comment) {
		container.addSeparatorComponents(separator());
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`> ${comment.replace(/\n/g, '\n> ')}`));
	}

	container.addSeparatorComponents(separator());
	container.addTextDisplayComponents(
		new TextDisplayBuilder().setContent(`-# Submitted by ${reviewer.tag} (\`${reviewer.id}\`)`),
	);

	return container;
}

/** Post a review to the guild's configured review channel. Returns false if not configured. */
export async function postReviewToChannel(
	guild: Guild,
	ticketId: number,
	categoryLabel: string,
	reviewer: User,
	rating: number,
	comment: string | null,
): Promise<boolean> {
	const settings = await getReviewSettings(guild.id);
	if (!settings?.enabled || !settings.channelId) return false;

	const channel = guild.channels.cache.get(settings.channelId);
	if (!channel?.isTextBased()) return false;

	const container = buildReviewPost(ticketId, categoryLabel, reviewer, rating, comment);
	await (channel.send as (options: unknown) => Promise<unknown>)({
		components: [container],
		flags: CV2_FLAG,
	}).catch(() => null);

	return true;
}
