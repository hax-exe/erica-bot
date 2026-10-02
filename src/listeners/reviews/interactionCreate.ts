import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import {
	ActionRowBuilder,
	type ButtonInteraction,
	Events,
	type Interaction,
	MessageFlags,
	ModalBuilder,
	type ModalSubmitInteraction,
	TextDisplayBuilder,
	TextInputBuilder,
	TextInputStyle,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { isBotBlacklisted } from '../../lib/BlacklistUtil.js';
import { Colors, CV2_FLAG, errorReply, makeContainer } from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';
import {
	hasReview,
	postReviewToChannel,
	REVIEW_BTN_PREFIX,
	REVIEW_MODAL_PREFIX,
	STARS,
	saveReview,
} from '../../lib/ReviewUtil.js';
import { isDuplicateKeyError } from '../../lib/safe.js';

function r(opts: object) {
	// biome-ignore lint/suspicious/noExplicitAny: Discord.js reply type gap
	return opts as any;
}

@ApplyOptions<Listener.Options>({
	name: 'reviewInteractions',
	event: Events.InteractionCreate,
})
export class ReviewInteractionListener extends Listener<typeof Events.InteractionCreate> {
	public override async run(interaction: Interaction) {
		if (await isBotBlacklisted(interaction.user.id)) return;
		try {
			await this.dispatch(interaction);
			// biome-ignore lint/suspicious/noExplicitAny: Discord.js error code access
		} catch (err: any) {
			if (err?.code === 10062 || err?.code === 40060) return;
			throw err;
		}
	}

	private async dispatch(interaction: Interaction) {
		// ── Rating button ──────────────────────────────────────────────────────────
		if (interaction.isButton() && interaction.customId.startsWith(REVIEW_BTN_PREFIX)) {
			await this.handleRatingButton(interaction as ButtonInteraction);
			return;
		}

		// ── Review modal submit ────────────────────────────────────────────────────
		if (interaction.isModalSubmit() && interaction.customId.startsWith(REVIEW_MODAL_PREFIX)) {
			await this.handleModalSubmit(interaction as ModalSubmitInteraction);
			return;
		}
	}

	// ─── Rating button clicked ────────────────────────────────────────────────────

	private async handleRatingButton(interaction: ButtonInteraction) {
		// Custom ID: review:btn:{rating}:{ticketId}:{guildId}
		const rest = interaction.customId.slice(REVIEW_BTN_PREFIX.length);
		const parts = rest.split(':');
		if (parts.length < 3) return;
		const [ratingStr, ticketIdStr, guildId] = parts;
		const rating = parseInt(ratingStr, 10);
		const ticketId = parseInt(ticketIdStr, 10);

		if (Number.isNaN(rating) || rating < 1 || rating > 5 || Number.isNaN(ticketId)) return;

		// Make sure the user clicking is the ticket owner
		const ticket = await db
			.select()
			.from(schema.tickets)
			.where(eq(schema.tickets.id, ticketId))
			.limit(1)
			.then((r) => r[0] ?? null);

		if (!ticket) {
			await interaction.reply(
				r({
					content: '❌ Could not find the ticket associated with this review.',
					flags: MessageFlags.Ephemeral,
				}),
			);
			return;
		}

		if (ticket.userId !== interaction.user.id) {
			await interaction.reply(
				r({
					content: '❌ Only the ticket owner can submit a review.',
					flags: MessageFlags.Ephemeral,
				}),
			);
			return;
		}

		// One review per ticket
		if (await hasReview(ticketId)) {
			await interaction.reply(
				r({
					content: '❌ A review has already been submitted for this ticket.',
					flags: MessageFlags.Ephemeral,
				}),
			);
			return;
		}

		// Show modal for optional comment
		const modal = new ModalBuilder()
			.setCustomId(`${REVIEW_MODAL_PREFIX}${rating}:${ticketId}:${guildId}`)
			.setTitle(`${STARS[rating]} Review — ${rating}/5`)
			.addComponents(
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder()
						.setCustomId('comment')
						.setLabel('Leave a comment (optional)')
						.setStyle(TextInputStyle.Paragraph)
						.setPlaceholder('Tell us about your experience...')
						.setRequired(false)
						.setMaxLength(500),
				),
			);

		await interaction.showModal(modal);
	}

	// ─── Modal submitted ──────────────────────────────────────────────────────────

	private async handleModalSubmit(interaction: ModalSubmitInteraction) {
		// Custom ID: review:modal:{rating}:{ticketId}:{guildId}
		const rest = interaction.customId.slice(REVIEW_MODAL_PREFIX.length);
		const parts = rest.split(':');
		if (parts.length < 3) return;
		const [ratingStr, ticketIdStr, guildId] = parts;
		const rating = parseInt(ratingStr, 10);
		const ticketId = parseInt(ticketIdStr, 10);

		if (Number.isNaN(rating) || rating < 1 || rating > 5 || Number.isNaN(ticketId)) return;

		const comment = interaction.fields.getTextInputValue('comment').trim() || null;

		// Acknowledge first — saving, posting and the stats update can outlast the 3-second window.
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		try {
			await this.submitReview(interaction, ticketId, guildId, rating, comment);
		} catch (err) {
			// Don't leave the user on "thinking…"; the listener error handler still logs the failure.
			await interaction
				.editReply(errorReply('Something went wrong while saving your review. Please try again.'))
				.catch(() => null);
			throw err;
		}
	}

	private async submitReview(
		interaction: ModalSubmitInteraction,
		ticketId: number,
		guildId: string,
		rating: number,
		comment: string | null,
	) {
		// Guard: one review per ticket (the unique ticket_id index catches a concurrent double submit)
		const saved = (await hasReview(ticketId))
			? null
			: await saveReview(ticketId, guildId, interaction.user.id, rating, comment).catch((err) => {
					if (isDuplicateKeyError(err)) return null;
					throw err;
				});
		if (!saved) {
			await interaction.editReply(errorReply('A review has already been submitted for this ticket.'));
			return;
		}

		// Look up the ticket's category label for the channel post
		const ticket = await db
			.select()
			.from(schema.tickets)
			.where(eq(schema.tickets.id, ticketId))
			.limit(1)
			.then((r) => r[0] ?? null);

		// Post to the reviews channel in the guild
		const guild = interaction.client.guilds.cache.get(guildId);
		if (guild && ticket) {
			const { getCategoryById } = await import('../../lib/TicketManager.js');
			const cat = await getCategoryById(ticket.guildId, ticket.categoryId);
			await postReviewToChannel(guild, ticketId, cat?.label ?? ticket.categoryId, interaction.user, rating, comment);
			const { scheduleTicketStatsChannelUpdate } = await import('../../lib/TicketStatsChannelUtil.js');
			scheduleTicketStatsChannelUpdate(guild);
		}

		// Confirm to the user (works in DMs too) — edit the deferred modal reply
		const confirmContainer = makeContainer({ color: Colors.Success, header: 'Review Submitted!' });
		confirmContainer.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`Thanks for your feedback! You rated your experience **${rating}/5** ${STARS[rating]}.${comment ? `\n\n> ${comment}` : ''}`,
			),
		);
		// biome-ignore lint/suspicious/noExplicitAny: Discord.js CV2 flag type gap
		await interaction.editReply({ components: [confirmContainer], flags: CV2_FLAG } as any);
	}
}
