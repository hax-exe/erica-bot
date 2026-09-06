import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { type ComponentType, MessageFlags, PermissionFlagsBits, TextDisplayBuilder } from 'discord.js';
import { eq } from 'drizzle-orm';
import {
	Colors,
	CV2_FLAG,
	confirmCancelRow,
	errorReply,
	makeContainer,
	separator,
	successReply,
} from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';
import {
	checkHierarchy,
	createInfraction,
	deleteRecentUserMessages,
	dispatchModLog,
	handleReasonAutocomplete,
} from '../../lib/ModerationUtil.js';
import { humanDuration, parseDuration } from '../../lib/parseDuration.js';

const TIMEOUT_DURATION_PRESETS: Record<string, number> = {
	'60s': 60_000,
	'5m': 300_000,
	'10m': 600_000,
	'30m': 1_800_000,
	'1h': 3_600_000,
	'6h': 21_600_000,
	'12h': 43_200_000,
	'1d': 86_400_000,
	'3d': 259_200_000,
	'7d': 604_800_000,
	'28d': 2_419_200_000,
};

@ApplyOptions<Command.Options>({
	name: 'timeout',
	description: 'Temporarily mute (timeout) a member.',
	preconditions: ['Moderation'],
})
export class TimeoutCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('timeout')
				.setDescription('Temporarily mute (timeout) a member.')
				.addUserOption((o) => o.setName('user').setDescription('The member to timeout.').setRequired(true))
				.addStringOption((o) =>
					o
						.setName('duration')
						.setDescription('Timeout duration.')
						.setRequired(true)
						.addChoices(
							{ name: '60 seconds', value: '60s' },
							{ name: '5 minutes', value: '5m' },
							{ name: '10 minutes', value: '10m' },
							{ name: '30 minutes', value: '30m' },
							{ name: '1 hour', value: '1h' },
							{ name: '6 hours', value: '6h' },
							{ name: '12 hours', value: '12h' },
							{ name: '1 day', value: '1d' },
							{ name: '3 days', value: '3d' },
							{ name: '7 days', value: '7d' },
							{ name: '28 days (max)', value: '28d' },
						),
				)
				.addStringOption((o) =>
					o.setName('reason').setDescription('Reason for the timeout.').setRequired(false).setAutocomplete(true),
				)
				.addStringOption((o) =>
					o
						.setName('custom_duration')
						.setDescription('Custom duration instead of preset (e.g. 45m, 2h30m, 13h). Max 28 days.')
						.setRequired(false),
				)
				.addIntegerOption((o) =>
					o
						.setName('delete_messages')
						.setDescription('Number of recent messages from this user to delete in this channel (0-100).')
						.setMinValue(0)
						.setMaxValue(100)
						.setRequired(false),
				)
				.addAttachmentOption((o) =>
					o
						.setName('proof')
						.setDescription('Proof attachment (required if configured by server staff).')
						.setRequired(false),
				),
		);
	}

	public override async autocompleteRun(interaction: Command.AutocompleteInteraction) {
		return handleReasonAutocomplete(interaction);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}

		if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
			return interaction.editReply(errorReply('You do not have permission to moderate members.'));
		}

		const target = interaction.options.getMember('user');
		if (!target) {
			return interaction.editReply(errorReply('That user is not in this server.'));
		}

		const durationKey = interaction.options.getString('duration', true);
		const customDurationStr = interaction.options.getString('custom_duration');
		const reason = interaction.options.getString('reason') ?? 'No reason provided';
		const deleteMessages = interaction.options.getInteger('delete_messages') ?? 0;
		const proofAttachment = interaction.options.getAttachment('proof');
		const guild = interaction.guild;

		let durationMs: number;
		let durationLabel: string;

		if (customDurationStr) {
			const parsed = parseDuration(customDurationStr);
			if (!parsed)
				return interaction.editReply(errorReply('Invalid custom duration. Use formats like `45m`, `2h`, `1d`.'));
			const maxMs = 28 * 24 * 60 * 60 * 1000;
			if (parsed > maxMs) return interaction.editReply(errorReply('Max timeout duration is 28 days.'));
			durationMs = parsed;
			durationLabel = humanDuration(durationMs);
		} else {
			durationMs = TIMEOUT_DURATION_PRESETS[durationKey];
			durationLabel = durationKey;
		}

		if (target.id === interaction.user.id) {
			return interaction.editReply(errorReply('You cannot timeout yourself.'));
		}
		const h = checkHierarchy(interaction.member, target);
		if (!h.ok) return interaction.editReply(errorReply(h.reason));
		if (!target.moderatable) {
			return interaction.editReply(errorReply('I cannot timeout this user (missing permissions or higher role).'));
		}

		const guildRow = await db.query.guilds.findFirst({ where: eq(schema.guilds.id, guild.id) });
		const proofRequired = guildRow?.proofRequired ?? false;
		const requireReview = guildRow?.requireReview ?? false;

		if (proofRequired && !proofAttachment) {
			return interaction.editReply(
				errorReply(
					'Proof is required to execute punishments on this server. Please upload an attachment using the `proof` option.',
				),
			);
		}

		if (requireReview) {
			const confirmId = `confirm-${interaction.id}`;
			const cancelId = `cancel-${interaction.id}`;
			const reviewContainer = makeContainer({ color: Colors.Warning, header: 'Review Timeout' });
			reviewContainer.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`Please review and confirm the following punishment:\n\n` +
						`• **Action** Timeout\n` +
						`• **User** ${target.user.username} (${target.id})\n` +
						`• **Duration** ${durationLabel}\n` +
						`• **Reason** ${reason}` +
						(deleteMessages > 0 ? `\n• **Clean Messages:** Delete last ${deleteMessages} message(s)` : '') +
						(proofAttachment ? `\n• **Proof** Attached (${proofAttachment.name})` : ''),
				),
			);
			reviewContainer.addSeparatorComponents(separator());
			reviewContainer.addActionRowComponents(confirmCancelRow(confirmId, cancelId));

			const reply = await interaction.editReply({ components: [reviewContainer], flags: CV2_FLAG });

			const collector = reply.createMessageComponentCollector<ComponentType.Button>({
				filter: (i) => i.user.id === interaction.user.id && (i.customId === confirmId || i.customId === cancelId),
				time: 60_000,
				max: 1,
			});

			const confirmed = await new Promise<boolean>((resolve) => {
				collector.on('collect', async (i) => {
					if (i.customId === confirmId) {
						await i.deferUpdate();
						resolve(true);
					} else {
						const cancelledContainer = makeContainer({ color: Colors.Neutral });
						cancelledContainer.addTextDisplayComponents(
							new TextDisplayBuilder().setContent('Punishment execution cancelled.'),
						);
						await i.update({ components: [cancelledContainer], flags: CV2_FLAG });
						resolve(false);
					}
				});

				collector.on('end', async (_, reasonCollected) => {
					if (reasonCollected === 'time') {
						const timedOutContainer = makeContainer({ color: Colors.Neutral });
						timedOutContainer.addTextDisplayComponents(
							new TextDisplayBuilder().setContent('Punishment review timed out.'),
						);
						await interaction.editReply({ components: [timedOutContainer], flags: CV2_FLAG }).catch(() => null);
						resolve(false);
					}
				});
			});

			if (!confirmed) return;
		}

		try {
			const dm = makeContainer({ color: Colors.Moderation, header: `You have been timed out in ${guild.name}` });
			dm.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(`**Reason** ${reason}\n-# Duration: **${durationLabel}**`),
			);
			await target.send({ components: [dm], flags: CV2_FLAG }).catch(() => null);

			await target.timeout(durationMs, `[${interaction.user.username}] ${reason}`);

			const infraction = await createInfraction({
				guildId: guild.id,
				userId: target.id,
				moderatorId: interaction.user.id,
				type: 'timeout',
				reason,
				duration: durationMs,
				proofUrl: proofAttachment?.url ?? null,
			});

			let deletedCount = 0;
			if (deleteMessages > 0 && interaction.channel?.isTextBased()) {
				deletedCount = await deleteRecentUserMessages(interaction.channel as any, target.id, deleteMessages);
			}

			await dispatchModLog({
				guild,
				targetUser: target.user,
				moderator: interaction.user,
				type: 'timeout',
				reason: deletedCount > 0 ? `${reason} (Cleaned up ${deletedCount} message(s))` : reason,
				duration: durationMs,
				caseId: infraction.caseId,
				proofAttachment,
			});

			const deleteText = deletedCount > 0 ? `\n🗑️ Deleted **${deletedCount}** message(s) in this channel.` : '';
			return interaction.editReply(
				successReply(
					`**${target.user.username}** has been timed out for **${durationLabel}**. Case \`${infraction.caseId}\`.${deleteText}`,
				),
			);
		} catch (err) {
			this.container.logger.error(err);
			return interaction.editReply(errorReply('Failed to timeout the user.'));
		}
	}
}
