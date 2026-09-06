import type { Subcommand } from '@sapphire/plugin-subcommands';
import { MessageFlags, type TextChannel, TextDisplayBuilder } from 'discord.js';
import { eq } from 'drizzle-orm';
import { CV2_FLAG, errorReply, makeContainer, successReply } from '../../../lib/components.js';
import { db, schema } from '../../../lib/database.js';
import {
	buildSuggestionContainer,
	getSuggestion,
	getSuggestionSettings,
	STATUS_LABEL,
	upsertSuggestionSettings,
} from '../../../lib/SuggestionUtil.js';

export class SuggestionHandler {
	// ── /suggestion setup channel ─────────────────────────────────────────────────

	public async chatInputSetupChannel(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Guild only.'));

		const channel = interaction.options.getChannel('channel', true);
		await upsertSuggestionSettings(interaction.guild.id, { channelId: channel.id });
		return interaction.editReply(successReply(`Suggestion channel set to <#${channel.id}>.`));
	}

	// ── /suggestion setup dm-updates ──────────────────────────────────────────────

	public async chatInputSetupDm(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Guild only.'));

		const enabled = interaction.options.getBoolean('enabled', true);
		await upsertSuggestionSettings(interaction.guild.id, { dmOnUpdate: enabled });
		return interaction.editReply(successReply(`DM notifications ${enabled ? 'enabled' : 'disabled'}.`));
	}

	// ── Shared review handler ─────────────────────────────────────────────────────

	private async handleReview(
		interaction: Subcommand.ChatInputCommandInteraction,
		newStatus: 'approved' | 'denied' | 'implemented',
	) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Guild only.'));

		const id = interaction.options.getInteger('id', true);
		const reason = interaction.options.getString('reason') ?? undefined;

		const suggestion = await getSuggestion(id);
		if (!suggestion) return interaction.editReply(errorReply(`Suggestion #${id} not found.`));
		if (suggestion.guildId !== interaction.guild.id)
			return interaction.editReply(errorReply('That suggestion is not from this server.'));
		if (suggestion.status === newStatus) {
			return interaction.editReply(errorReply(`Suggestion #${id} is already **${suggestion.status}**.`));
		}

		// Update DB
		await db
			.update(schema.suggestions)
			.set({ status: newStatus, reviewedById: interaction.user.id, reviewReason: reason ?? null })
			.where(eq(schema.suggestions.id, id));
		const [updated] = await db.select().from(schema.suggestions).where(eq(schema.suggestions.id, id)).limit(1);
		if (!updated) return interaction.editReply(errorReply(`Suggestion #${id} not found.`));

		// Edit the suggestion message
		const channel = interaction.guild.channels.cache.get(updated.channelId) as TextChannel | undefined;
		if (channel?.isTextBased()) {
			const msg = await channel.messages.fetch(updated.messageId).catch(() => null);
			if (msg) {
				await msg.edit({ components: [buildSuggestionContainer(updated)], flags: CV2_FLAG }).catch(() => null);
			}
		}

		// DM the submitter if configured
		const settings = await getSuggestionSettings(interaction.guild.id);
		if (settings?.dmOnUpdate && updated.userId) {
			const owner = await interaction.client.users.fetch(updated.userId).catch(() => null);
			if (owner) {
				const dm = makeContainer({
					color: newStatus === 'approved' || newStatus === 'implemented' ? 0x57f287 : 0xed4245,
				});
				dm.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(
						`### Your suggestion was ${STATUS_LABEL[newStatus].toLowerCase()}\n\n**Server** ${interaction.guild.name}\n**Suggestion #${id}** ${updated.content}${reason ? `\n**Reason** ${reason}` : ''}`,
					),
				);
				await owner.send({ components: [dm], flags: CV2_FLAG }).catch(() => null);
			}
		}

		return interaction.editReply(successReply(`Suggestion #${id} marked as **${STATUS_LABEL[newStatus]}**.`));
	}

	public async chatInputApprove(interaction: Subcommand.ChatInputCommandInteraction) {
		return this.handleReview(interaction, 'approved');
	}

	public async chatInputDeny(interaction: Subcommand.ChatInputCommandInteraction) {
		return this.handleReview(interaction, 'denied');
	}

	public async chatInputImplement(interaction: Subcommand.ChatInputCommandInteraction) {
		return this.handleReview(interaction, 'implemented');
	}
}
