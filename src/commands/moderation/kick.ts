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

@ApplyOptions<Command.Options>({
	name: 'kick',
	description: 'Kick a member from the server.',
	preconditions: ['Moderation'],
})
export class KickCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('kick')
				.setDescription('Kick a member from the server.')
				.addUserOption((o) => o.setName('user').setDescription('The member to kick.').setRequired(true))
				.addStringOption((o) =>
					o.setName('reason').setDescription('Reason for the kick.').setRequired(false).setAutocomplete(true),
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

		if (!interaction.member.permissions.has(PermissionFlagsBits.KickMembers)) {
			return interaction.editReply(errorReply('You do not have permission to kick members.'));
		}

		const target = interaction.options.getMember('user');
		if (!target) {
			return interaction.editReply(errorReply('That user is not in this server.'));
		}

		const reason = interaction.options.getString('reason') ?? 'No reason provided';
		const deleteMessages = interaction.options.getInteger('delete_messages') ?? 0;
		const proofAttachment = interaction.options.getAttachment('proof');
		const guild = interaction.guild;

		if (!target.kickable) {
			return interaction.editReply(errorReply('I cannot kick this user (missing permissions or higher role).'));
		}
		if (target.id === interaction.user.id) {
			return interaction.editReply(errorReply('You cannot kick yourself.'));
		}
		const h = checkHierarchy(interaction.member, target);
		if (!h.ok) return interaction.editReply(errorReply(h.reason));

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
			const reviewContainer = makeContainer({ color: Colors.Warning, header: 'Review Kick' });
			reviewContainer.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`Please review and confirm the following punishment:\n\n` +
						`• **Action** Kick\n` +
						`• **User** ${target.user.username} (${target.id})\n` +
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
			const dm = makeContainer({ color: Colors.Moderation, header: `You have been kicked from ${guild.name}` });
			dm.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Reason** ${reason}`));
			await target.send({ components: [dm], flags: CV2_FLAG }).catch(() => null);

			await target.kick(`[${interaction.user.username}] ${reason}`);

			const infraction = await createInfraction({
				guildId: guild.id,
				userId: target.id,
				moderatorId: interaction.user.id,
				type: 'kick',
				reason,
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
				type: 'kick',
				reason: deletedCount > 0 ? `${reason} (Cleaned up ${deletedCount} message(s))` : reason,
				caseId: infraction.caseId,
				proofAttachment,
			});

			const deleteText = deletedCount > 0 ? `\n🗑️ Deleted **${deletedCount}** message(s) in this channel.` : '';
			return interaction.editReply(
				successReply(`**${target.user.username}** has been kicked. Case \`${infraction.caseId}\`.${deleteText}`),
			);
		} catch (err) {
			this.container.logger.error(err);
			return interaction.editReply(errorReply('Failed to kick the user.'));
		}
	}
}
