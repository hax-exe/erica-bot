import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type ContainerBuilder, TextDisplayBuilder } from 'discord.js';
import { and, eq, sql } from 'drizzle-orm';
import type { SuggestionStatus } from '../db/schema.js';
import { Colors, makeContainer, separator } from './components.js';
import { db, schema } from './database.js';

export type { SuggestionStatus };
export type SuggestionRow = typeof schema.suggestions.$inferSelect;
export type SuggestionSettingsRow = typeof schema.suggestionSettings.$inferSelect;

// ─── Status metadata ───────────────────────────────────────────────────────────

export const STATUS_LABEL: Record<SuggestionStatus, string> = {
	pending: 'Pending',
	approved: 'Approved',
	denied: 'Denied',
	implemented: 'Implemented',
};

const STATUS_COLOR: Record<SuggestionStatus, number> = {
	pending: Colors.Info,
	approved: Colors.Success,
	denied: Colors.Error,
	implemented: Colors.Ticket,
};

// ─── DB helpers ────────────────────────────────────────────────────────────────

export async function getSuggestionSettings(guildId: string): Promise<SuggestionSettingsRow | null> {
	return db.query.suggestionSettings
		.findFirst({ where: eq(schema.suggestionSettings.guildId, guildId) })
		.then((r) => r ?? null);
}

export async function upsertSuggestionSettings(
	guildId: string,
	patch: Partial<typeof schema.suggestionSettings.$inferInsert>,
): Promise<void> {
	await db
		.insert(schema.suggestionSettings)
		.values({ guildId, ...patch })
		.onDuplicateKeyUpdate({ set: patch });
}

export async function getSuggestion(id: number): Promise<SuggestionRow | null> {
	return db.query.suggestions.findFirst({ where: eq(schema.suggestions.id, id) }).then((r) => r ?? null);
}

// ─── Vote helpers ──────────────────────────────────────────────────────────────

/** Toggle a vote. Returns the updated suggestion row. */
export async function castVote(suggestionId: number, userId: string, type: 'up' | 'down'): Promise<SuggestionRow> {
	await db.transaction(async (tx) => {
		const existing = await tx
			.select()
			.from(schema.suggestionVotes)
			.where(and(eq(schema.suggestionVotes.suggestionId, suggestionId), eq(schema.suggestionVotes.userId, userId)))
			.limit(1)
			.then((r) => r[0] ?? null);

		if (!existing) {
			await tx.insert(schema.suggestionVotes).values({ suggestionId, userId, vote: type });
			await tx
				.update(schema.suggestions)
				.set(
					type === 'up'
						? { upvotes: sql`${schema.suggestions.upvotes} + 1` }
						: { downvotes: sql`${schema.suggestions.downvotes} + 1` },
				)
				.where(eq(schema.suggestions.id, suggestionId));
		} else if (existing.vote === type) {
			// Same vote — toggle off
			await tx.delete(schema.suggestionVotes).where(eq(schema.suggestionVotes.id, existing.id));
			await tx
				.update(schema.suggestions)
				.set(
					type === 'up'
						? { upvotes: sql`GREATEST(${schema.suggestions.upvotes} - 1, 0)` }
						: { downvotes: sql`GREATEST(${schema.suggestions.downvotes} - 1, 0)` },
				)
				.where(eq(schema.suggestions.id, suggestionId));
		} else {
			// Opposite vote — switch
			await tx.update(schema.suggestionVotes).set({ vote: type }).where(eq(schema.suggestionVotes.id, existing.id));
			await tx
				.update(schema.suggestions)
				.set(
					type === 'up'
						? {
								upvotes: sql`${schema.suggestions.upvotes} + 1`,
								downvotes: sql`GREATEST(${schema.suggestions.downvotes} - 1, 0)`,
							}
						: {
								downvotes: sql`${schema.suggestions.downvotes} + 1`,
								upvotes: sql`GREATEST(${schema.suggestions.upvotes} - 1, 0)`,
							},
				)
				.where(eq(schema.suggestions.id, suggestionId));
		}
	});

	return (await getSuggestion(suggestionId))!;
}

// ─── Container builder ─────────────────────────────────────────────────────────

/** Build (or rebuild) the CV2 container for a suggestion message. */
export function buildSuggestionContainer(suggestion: SuggestionRow): ContainerBuilder {
	const status = suggestion.status;
	const container = makeContainer({
		color: STATUS_COLOR[status],
		header: `Suggestion #${suggestion.id}`,
	});

	container.addSeparatorComponents(separator());
	container.addTextDisplayComponents(new TextDisplayBuilder().setContent(suggestion.content));
	container.addSeparatorComponents(separator());

	let meta = `**Submitted by** <@${suggestion.userId}>\n**Status** ${STATUS_LABEL[status]}`;
	if (suggestion.reviewedById) meta += `\n**Reviewed by** <@${suggestion.reviewedById}>`;
	if (suggestion.reviewReason) meta += `\n**Reason** ${suggestion.reviewReason}`;

	container.addTextDisplayComponents(new TextDisplayBuilder().setContent(meta));
	container.addSeparatorComponents(separator());

	const ts = Math.floor(new Date(suggestion.createdAt).getTime() / 1000);
	container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# <t:${ts}:F>`));
	container.addSeparatorComponents(separator());

	container.addActionRowComponents(
		new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId(`suggestion:upvote:${suggestion.id}`)
				.setLabel(`${suggestion.upvotes}`)
				.setEmoji('👍')
				.setStyle(ButtonStyle.Success),
			new ButtonBuilder()
				.setCustomId(`suggestion:downvote:${suggestion.id}`)
				.setLabel(`${suggestion.downvotes}`)
				.setEmoji('👎')
				.setStyle(ButtonStyle.Danger),
		),
	);

	return container;
}
