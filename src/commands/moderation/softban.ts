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

@ApplyOptions<Command.Options>({
	name: 'softban',
	description: 'Softban a member (ban + immediate unban to purge messages).',
	preconditions: ['Moderation'],
})
export class SoftbanCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('softban')
				.setDescription('Softban a member (ban + immediate unban to purge messages).')
				.setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
				.addUserOption((o) => o.setName('user').setDescription('The member to softban.').setRequired(true))
				.addStringOption((o) =>
					o.setName('reason').setDescription('Reason for the softban.').setRequired(false).setAutocomplete(true),
				)
				.addIntegerOption((o) =>
					o
						.setName('delete_days')
						.setDescription('Days of message history to delete (default 1, max 7).')
						.setMinValue(1)
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
		const deleteDays = interaction.options.getInteger('delete_days') ?? 1;
		const proofAttachment = interaction.options.getAttachment('proof');
		const guild = interaction.guild;

		const member = guild.members.cache.get(target.id);
		if (member) {
			if (!member.bannable) {
				return interaction.editReply(errorReply('I cannot ban this user (missing permissions or higher role).'));
			}
			if (member.id === interaction.user.id) {
				return interaction.editReply(errorReply('You cannot softban yourself.'));
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
			const reviewContainer = makeContainer({ color: Colors.Warning, header: 'Review Softban' });
			reviewContainer.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`Please review and confirm the following punishment:\n\n` +
						`• **Action** Softban\n` +
						`• **User** ${target.username} (${target.id})\n` +
						`• **Reason** ${reason}` +
						`\n• **Clean Messages:** Delete last ${deleteDays} day(s) of messages` +
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
			const dm = makeContainer({ color: Colors.Moderation, header: `You have been softbanned from ${guild.name}` });
			dm.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`**Reason** ${reason}\n-# This ban was lifted immediately; you may rejoin.`,
				),
			);
			await target.send({ components: [dm], flags: CV2_FLAG }).catch(() => null);

			const auditReason = `[${interaction.user.username}] Softban — ${reason}`;
			await guild.bans.create(target.id, {
				reason: auditReason,
				deleteMessageSeconds: deleteDays * 86400,
			});
			await guild.bans.remove(target.id, auditReason);

			const infraction = await createInfraction({
				guildId: guild.id,
				userId: target.id,
				moderatorId: interaction.user.id,
				type: 'softban',
				reason,
				proofUrl: proofAttachment?.url ?? null,
			});

			await dispatchModLog({
				guild,
				targetUser: target,
				moderator: interaction.user,
				type: 'softban',
				reason,
				caseId: infraction.caseId,
				proofAttachment,
			});

			return interaction.editReply(
				successReply(
					`**${target.username}** has been softbanned (${deleteDays}d of messages purged). Case \`${infraction.caseId}\`.`,
				),
			);
		} catch (err) {
			this.container.logger.error(err);
			return interaction.editReply(errorReply('Failed to softban the user.'));
		}
	}
}
