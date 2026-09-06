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
	dispatchModLog,
	handleReasonAutocomplete,
} from '../../lib/ModerationUtil.js';
import { autocompleteDuration, DURATION_HINT, humanDuration, parseDuration } from '../../lib/parseDuration.js';

@ApplyOptions<Command.Options>({
	name: 'ban',
	description: 'Ban a member from the server.',
	preconditions: ['Moderation'],
})
export class BanCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('ban')
				.setDescription('Ban a member from the server.')
				.addUserOption((o) => o.setName('user').setDescription('The user to ban.').setRequired(true))
				.addStringOption((o) =>
					o.setName('reason').setDescription('Reason for the ban.').setRequired(false).setAutocomplete(true),
				)
				.addStringOption((o) =>
					o
						.setName('duration')
						.setDescription('Temp ban duration (e.g. 7d, 24h). Omit for permanent.')
						.setRequired(false)
						.setAutocomplete(true),
				)
				.addIntegerOption((o) =>
					o
						.setName('delete_days')
						.setDescription('Number of days of messages to delete (0–7).')
						.setMinValue(0)
						.setMaxValue(7)
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
		const focused = interaction.options.getFocused(true);
		if (focused.name === 'duration') {
			return interaction.respond(autocompleteDuration(focused.value));
		}
		return handleReasonAutocomplete(interaction);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}

		if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
			return interaction.editReply(errorReply('You do not have permission to ban members.'));
		}

		const target = interaction.options.getUser('user', true);
		const reason = interaction.options.getString('reason') ?? 'No reason provided';
		const deleteDays = interaction.options.getInteger('delete_days') ?? 0;
		const durationStr = interaction.options.getString('duration');
		const proofAttachment = interaction.options.getAttachment('proof');
		const guild = interaction.guild;

		let durationMs: number | undefined;
		if (durationStr) {
			const parsed = parseDuration(durationStr);
			if (!parsed) return interaction.editReply(errorReply(`Invalid duration. ${DURATION_HINT}`));
			durationMs = parsed;
		}

		const member = guild.members.cache.get(target.id);
		if (member) {
			if (!member.bannable) {
				return interaction.editReply(
					errorReply("I can't ban this member — my role is too low, or I'm missing the Ban Members permission."),
				);
			}
			if (member.id === interaction.user.id) {
				return interaction.editReply(errorReply('You cannot ban yourself.'));
			}
			const h = checkHierarchy(interaction.member, member);
			if (!h.ok) return interaction.editReply(errorReply(h.reason));
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
			const reviewContainer = makeContainer({ color: Colors.Warning, header: 'Review Ban' });
			reviewContainer.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`Please review and confirm the following punishment:\n\n` +
						`• **Action** Ban\n` +
						`• **User** ${target.username} (${target.id})\n` +
						`• **Reason** ${reason}` +
						(durationStr ? `\n• **Duration** ${durationStr}` : '') +
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
			const banDmColor = durationMs ? Colors.Moderation : Colors.Error;
			const banLabel = durationMs ? `temporarily banned for **${humanDuration(durationMs)}**` : 'permanently banned';
			const dm = makeContainer({ color: banDmColor, header: `You have been banned from ${guild.name}` });
			dm.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(`**Reason** ${reason}\n-# You were ${banLabel}.`),
			);
			await target.send({ components: [dm], flags: CV2_FLAG }).catch(() => null);

			await guild.bans.create(target.id, {
				reason: `[${interaction.user.username}] ${reason}`,
				deleteMessageSeconds: deleteDays * 86400,
			});

			const infraction = await createInfraction({
				guildId: guild.id,
				userId: target.id,
				moderatorId: interaction.user.id,
				type: 'ban',
				reason,
				duration: durationMs,
				proofUrl: proofAttachment?.url ?? null,
			});

			if (durationMs) {
				await db.insert(schema.tempbans).values({
					guildId: guild.id,
					userId: target.id,
					expiresAt: new Date(Date.now() + durationMs),
					caseId: infraction.caseId,
				});
			}

			await dispatchModLog({
				guild,
				targetUser: target,
				moderator: interaction.user,
				type: 'ban',
				reason,
				caseId: infraction.caseId,
				duration: durationMs,
				proofAttachment,
			});

			const durationNote = durationMs ? ` for **${humanDuration(durationMs)}**` : ' permanently';
			return interaction.editReply(
				successReply(`**${target.username}** has been banned${durationNote}. Case \`${infraction.caseId}\`.`),
			);
		} catch (err) {
			this.container.logger.error(err);
			return interaction.editReply(errorReply('Failed to ban the user. Do I have the correct permissions?'));
		}
	}
}
