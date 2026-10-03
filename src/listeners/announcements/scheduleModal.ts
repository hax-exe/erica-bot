import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Events, type Interaction, MessageFlags, type ModalSubmitInteraction, PermissionFlagsBits } from 'discord.js';
import { and, count, eq } from 'drizzle-orm';
import {
	ANNOUNCE_PING_PERMISSION_ERROR,
	botPostPermissionError,
	canSendAnnouncePing,
	MAX_ACTIVE_SCHEDULES,
	takePendingSchedule,
} from '../../lib/AnnouncementUtil.js';
import { isBotBlacklisted } from '../../lib/BlacklistUtil.js';
import { errorReply, successReply } from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';
import { humanDuration } from '../../lib/parseDuration.js';

const MODAL_PREFIX = 'schedule_modal:';
const table = schema.scheduledAnnouncements;

@ApplyOptions<Listener.Options>({
	name: 'scheduleModalSubmit',
	event: Events.InteractionCreate,
})
export class ScheduleModalListener extends Listener<typeof Events.InteractionCreate> {
	public override async run(interaction: Interaction) {
		if (!interaction.isModalSubmit()) return;
		if (!interaction.customId.startsWith(MODAL_PREFIX)) return;
		if (!interaction.inCachedGuild()) return;
		if (await isBotBlacklisted(interaction.user.id)) return;

		try {
			await this.handle(interaction);
		} catch (err) {
			// Stale (bot restarted) or already-acknowledged interaction — nothing to answer.
			const code = (err as { code?: unknown } | null)?.code;
			if (code === 10062 || code === 40060) return;
			this.container.logger.error('[Schedule] Failed to create scheduled announcement:', err);
			if (interaction.deferred) {
				await interaction
					.editReply(errorReply('Something went wrong while scheduling the announcement. Please try again.'))
					.catch(() => undefined);
			}
		}
	}

	private async handle(interaction: ModalSubmitInteraction<'cached'>) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		// `/schedule` requires Manage Server; re-check since the form may have been open a while.
		if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
			return interaction.editReply(errorReply('You need the **Manage Server** permission to schedule announcements.'));
		}

		// Custom ID format: schedule_modal:NONCE
		const nonce = interaction.customId.slice(MODAL_PREFIX.length);
		const pending = takePendingSchedule(interaction.user.id, nonce);
		if (!pending || pending.guildId !== interaction.guildId) {
			return interaction.editReply(
				errorReply('This form has expired. Run `/schedule create` again to schedule the announcement.'),
			);
		}

		const heading = interaction.fields.getTextInputValue('heading').trim() || null;
		const body = interaction.fields.getTextInputValue('body');
		if (!body.trim()) {
			return interaction.editReply(errorReply('The announcement message cannot be empty.'));
		}

		const channel = interaction.guild.channels.cache.get(pending.channelId);
		if (!channel?.isTextBased()) {
			return interaction.editReply(errorReply('Could not find the target channel.'));
		}
		// Permissions can change while the form is open, so check again before saving.
		const me = interaction.guild.members.me ?? (await interaction.guild.members.fetchMe().catch(() => null));
		const botError = botPostPermissionError(channel, me);
		if (botError) {
			return interaction.editReply(errorReply(botError));
		}
		if (!canSendAnnouncePing(interaction.member, channel, pending.pingType, pending.pingId)) {
			return interaction.editReply(errorReply(ANNOUNCE_PING_PERMISSION_ERROR));
		}

		const [{ active }] = await db
			.select({ active: count() })
			.from(table)
			.where(and(eq(table.guildId, interaction.guildId), eq(table.active, true)));
		if (active >= MAX_ACTIVE_SCHEDULES) {
			return interaction.editReply(
				errorReply(
					`This server already has **${MAX_ACTIVE_SCHEDULES}** active scheduled announcements. Delete one with \`/schedule delete\` first.`,
				),
			);
		}

		const now = Date.now();
		const nextRunAt = now + pending.delayMs;
		const [{ id }] = await db
			.insert(table)
			.values({
				guildId: interaction.guildId,
				channelId: pending.channelId,
				createdBy: interaction.user.id,
				heading,
				body,
				color: pending.color,
				pingType: pending.pingType,
				pingId: pending.pingId,
				nextRunAt,
				intervalMs: pending.intervalMs,
				createdAt: now,
			})
			.$returningId();

		const first = Math.floor(nextRunAt / 1000);
		const repeat = pending.intervalMs ? ` Repeats every **${humanDuration(pending.intervalMs)}**.` : '';
		return interaction.editReply(
			successReply(
				`Scheduled announcement \`#${id}\` for <#${pending.channelId}>. First run <t:${first}:F> (<t:${first}:R>).${repeat}`,
			),
		);
	}
}
