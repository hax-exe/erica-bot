import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import {
	ActionRowBuilder,
	Events,
	type Interaction,
	MessageFlags,
	ModalBuilder,
	PermissionFlagsBits,
	SeparatorBuilder,
	SeparatorSpacingSize,
	TextDisplayBuilder,
	TextInputBuilder,
	TextInputStyle,
	userMention,
} from 'discord.js';
import { and, eq, gte } from 'drizzle-orm';
import { isBotBlacklisted } from '../../lib/BlacklistUtil.js';
import {
	Colors,
	CV2_FLAG,
	cv2Reply,
	errorReply,
	logContainer,
	makeContainer,
	separator,
	successReply,
	warningReply,
} from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';
import {
	applyWarnEscalation,
	checkHierarchy,
	createInfraction,
	dispatchModLog,
	getInfractionByCase,
	getInfractions,
} from '../../lib/ModerationUtil.js';
import { humanDuration, parseDuration } from '../../lib/parseDuration.js';
import { buildActiveTimeoutsPage } from '../paginationInteractions.js';

const DURATION_PRESETS: Record<string, number> = {
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

const DURATION_LABELS: Record<string, string> = {
	'60s': '60 seconds',
	'5m': '5 minutes',
	'10m': '10 minutes',
	'30m': '30 minutes',
	'1h': '1 hour',
	'6h': '6 hours',
	'12h': '12 hours',
	'1d': '1 day',
	'3d': '3 days',
	'7d': '7 days',
	'28d': '28 days',
};

const INFRACTION_EMOJI: Record<string, string> = {
	ban: '🔨',
	unban: '🔓',
	kick: '👢',
	timeout: '⏱️',
	untimeout: '🔊',
	softban: '💥',
	warn: '⚠️',
};

@ApplyOptions<Listener.Options>({
	name: 'modButtonInteractions',
	event: Events.InteractionCreate,
})
export class ModButtonListener extends Listener<typeof Events.InteractionCreate> {
	public override async run(interaction: Interaction) {
		if (!interaction.inCachedGuild()) return;
		if (await isBotBlacklisted(interaction.user.id)) return;

		// ── Button handler ───────────────────────────────────────────────────────
		if (interaction.isButton() && interaction.customId.startsWith('mod:')) {
			const [, action, targetId, extraId] = interaction.customId.split(':');

			if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
				// biome-ignore lint/suspicious/noExplicitAny: CV2 flag type gap between reply/editReply
				return interaction.reply(errorReply('You do not have permission to use moderation actions.') as any);
			}

			// Actions that need a modal first
			if (action === 'warn' || action === 'kick' || action === 'timeout' || action === 'ban') {
				const modal = new ModalBuilder().setCustomId(`mod_modal:${action}:${targetId}`);

				if (action === 'warn') {
					modal.setTitle('Warn User');
					modal.addComponents(
						new ActionRowBuilder<TextInputBuilder>().addComponents(
							new TextInputBuilder()
								.setCustomId('reason')
								.setLabel('Reason')
								.setStyle(TextInputStyle.Paragraph)
								.setRequired(true)
								.setMaxLength(500),
						),
					);
				}

				if (action === 'kick') {
					modal.setTitle('Kick User');
					modal.addComponents(
						new ActionRowBuilder<TextInputBuilder>().addComponents(
							new TextInputBuilder()
								.setCustomId('reason')
								.setLabel('Reason')
								.setStyle(TextInputStyle.Paragraph)
								.setRequired(true)
								.setMaxLength(500),
						),
					);
				}

				if (action === 'timeout') {
					modal.setTitle('Timeout User');
					modal.addComponents(
						new ActionRowBuilder<TextInputBuilder>().addComponents(
							new TextInputBuilder()
								.setCustomId('duration')
								.setLabel('Duration (60s / 5m / 10m / 30m / 1h / 6h / 12h / 1d / 3d / 7d / 28d)')
								.setStyle(TextInputStyle.Short)
								.setRequired(true)
								.setPlaceholder('e.g. 1h'),
						),
						new ActionRowBuilder<TextInputBuilder>().addComponents(
							new TextInputBuilder()
								.setCustomId('reason')
								.setLabel('Reason')
								.setStyle(TextInputStyle.Paragraph)
								.setRequired(true)
								.setMaxLength(500),
						),
					);
				}

				if (action === 'ban') {
					modal.setTitle('Ban User');
					modal.addComponents(
						new ActionRowBuilder<TextInputBuilder>().addComponents(
							new TextInputBuilder()
								.setCustomId('reason')
								.setLabel('Reason')
								.setStyle(TextInputStyle.Paragraph)
								.setRequired(true)
								.setMaxLength(500),
						),
						new ActionRowBuilder<TextInputBuilder>().addComponents(
							new TextInputBuilder()
								.setCustomId('duration')
								.setLabel('Temp ban duration (e.g. 7d, 24h — blank = permanent)')
								.setStyle(TextInputStyle.Short)
								.setRequired(false)
								.setPlaceholder('leave blank for permanent'),
						),
						new ActionRowBuilder<TextInputBuilder>().addComponents(
							new TextInputBuilder()
								.setCustomId('delete_days')
								.setLabel('Delete message history (days, 0–7)')
								.setStyle(TextInputStyle.Short)
								.setRequired(false)
								.setPlaceholder('0'),
						),
					);
				}

				return interaction.showModal(modal);
			}

			// ── Untimeout (immediate) ──────────────────────────────────────────────
			if (action === 'untimeout') {
				await interaction.deferReply({ flags: MessageFlags.Ephemeral });
				const member = await interaction.guild.members.fetch(targetId).catch(() => null);
				if (!member) return interaction.editReply(errorReply('Could not find that member.'));

				const h = checkHierarchy(interaction.member, member);
				if (!h.ok) return interaction.editReply(errorReply(h.reason));

				if (!member.communicationDisabledUntilTimestamp || member.communicationDisabledUntilTimestamp < Date.now()) {
					return interaction.editReply(errorReply('This user is not currently timed out.'));
				}

				try {
					await member.timeout(null, `[${interaction.user.username}] Removed via mod button`);

					const infraction = await createInfraction({
						guildId: interaction.guild.id,
						userId: targetId,
						moderatorId: interaction.user.id,
						type: 'untimeout',
						reason: 'Removed via mod button',
					});

					await dispatchModLog({
						guild: interaction.guild,
						targetUser: member.user,
						moderator: interaction.user,
						type: 'untimeout',
						reason: 'Removed via mod button',
						caseId: infraction.caseId,
					});

					return interaction.editReply(successReply(`Timeout removed from **${member.user.username}**.`));
				} catch {
					return interaction.editReply(errorReply('Failed to remove the timeout.'));
				}
			}

			// ── Unban (immediate) ─────────────────────────────────────────────────
			if (action === 'unban') {
				await interaction.deferReply({ flags: MessageFlags.Ephemeral });
				const target = await interaction.client.users.fetch(targetId).catch(() => null);
				if (!target) return interaction.editReply(errorReply('Could not find that user.'));

				if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
					return interaction.editReply(errorReply('You do not have permission to unban members.'));
				}

				try {
					await interaction.guild.bans.remove(targetId, `[${interaction.user.username}] Removed via mod button`);

					const infraction = await createInfraction({
						guildId: interaction.guild.id,
						userId: targetId,
						moderatorId: interaction.user.id,
						type: 'unban',
						reason: 'Removed via mod button',
					});

					await dispatchModLog({
						guild: interaction.guild,
						targetUser: target,
						moderator: interaction.user,
						type: 'unban',
						reason: 'Removed via mod button',
						caseId: infraction.caseId,
					});

					return interaction.editReply(successReply(`**${target.username}** has been unbanned.`));
				} catch {
					return interaction.editReply(errorReply('Failed to unban. They may not be banned.'));
				}
			}

			// ── History (ephemeral) ───────────────────────────────────────────────
			if (action === 'history') {
				await interaction.deferReply({ flags: MessageFlags.Ephemeral });
				const target = await interaction.client.users.fetch(targetId).catch(() => null);
				const infractions = await getInfractions(interaction.guild.id, targetId);

				const container = makeContainer({
					color: infractions.length === 0 ? Colors.Success : Colors.Warning,
					header: `Moderation History — ${target?.username ?? targetId}`,
				});

				container.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(
						`${userMention(targetId)} \`${targetId}\` — **${infractions.length}** infraction(s) total`,
					),
				);

				if (infractions.length === 0) {
					container.addTextDisplayComponents(new TextDisplayBuilder().setContent('✅ No infractions found.'));
				} else {
					container.addSeparatorComponents(separator());
					for (const inf of infractions.slice(0, 10)) {
						const emoji = INFRACTION_EMOJI[inf.type] ?? '📌';
						const ts = Math.floor(new Date(inf.createdAt).getTime() / 1000);
						container.addTextDisplayComponents(
							new TextDisplayBuilder().setContent(
								`${emoji} **Case \`${inf.caseId}\`** — ${inf.type.toUpperCase()}\n` +
									`**Moderator** <@${inf.moderatorId}>\n` +
									`**Reason** ${inf.reason}\n` +
									`-# <t:${ts}:F>`,
							),
						);
						container.addSeparatorComponents(
							new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small),
						);
					}
					if (infractions.length > 10) {
						container.addTextDisplayComponents(
							new TextDisplayBuilder().setContent(`-# … and ${infractions.length - 10} more`),
						);
					}
				}

				return interaction.editReply(cv2Reply(container, true));
			}

			// ── Case Edit ─────────────────────────────────────────────────────────
			if (action === 'case_edit') {
				const caseId = targetId;
				const infraction = await getInfractionByCase(interaction.guild.id, caseId);
				if (!infraction) {
					return interaction.reply(errorReply(`No case found with ID \`${caseId}\`.`) as any);
				}

				const modal = new ModalBuilder()
					.setCustomId(`mod_modal:case_edit:${caseId}`)
					.setTitle('Edit Case Reason')
					.addComponents(
						new ActionRowBuilder<TextInputBuilder>().addComponents(
							new TextInputBuilder()
								.setCustomId('reason')
								.setLabel('New Reason')
								.setStyle(TextInputStyle.Paragraph)
								.setRequired(true)
								.setValue(infraction.reason)
								.setMaxLength(500),
						),
					);

				return interaction.showModal(modal);
			}

			// ── Case Delete ───────────────────────────────────────────────────────
			if (action === 'case_delete') {
				await interaction.deferReply({ flags: MessageFlags.Ephemeral });
				const caseId = targetId;
				const infraction = await getInfractionByCase(interaction.guild.id, caseId);
				if (!infraction) {
					return interaction.editReply(errorReply(`Case \`${caseId}\` not found.`));
				}

				const { deleteInfraction } = await import('../../lib/ModerationUtil.js');
				await deleteInfraction(interaction.guild.id, caseId);

				const targetUser = await interaction.client.users.fetch(infraction.userId).catch(() => null);
				const userLabel = targetUser
					? `${userMention(targetUser.id)} (${targetUser.username} • \`${targetUser.id}\`)`
					: `Unknown User (\`${infraction.userId}\`)`;

				const { sendModLog } = await import('../../lib/LoggingUtil.js');
				await sendModLog(
					interaction.guild,
					logContainer({
						title: 'Infraction Removed',
						color: Colors.Success,
						fields: [
							{ name: 'Case', value: `\`${caseId}\` (${infraction.type})` },
							{ name: 'User', value: userLabel },
							{ name: 'Moderator', value: `${userMention(interaction.user.id)} (${interaction.user.username})` },
							{ name: 'Original Reason', value: infraction.reason },
						],
						timestamp: true,
					}),
				).catch(() => null);

				const targetName = targetUser ? `from **${targetUser.username}**` : `(User ID: \`${infraction.userId}\`)`;
				return interaction.editReply(successReply(`Case \`${caseId}\` (${infraction.type}) removed ${targetName}.`));
			}

			// ── Slowmode Button ───────────────────────────────────────────────────
			if (action === 'slowmode') {
				await interaction.deferReply({ flags: MessageFlags.Ephemeral });
				const seconds = parseInt(targetId, 10);
				const channelId = extraId || interaction.channelId;
				const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
				if (!channel || !channel.isTextBased()) {
					return interaction.editReply(errorReply('Channel not found or is not text-based.'));
				}

				if ('setRateLimitPerUser' in channel) {
					try {
						await channel.setRateLimitPerUser(seconds, `[${interaction.user.username}] Slowmode changed via button`);

						const { sendModLog } = await import('../../lib/LoggingUtil.js');
						await sendModLog(
							interaction.guild,
							logContainer({
								title: 'Slowmode Changed',
								color: Colors.Moderation,
								fields: [
									{ name: 'Channel', value: `<#${channel.id}>` },
									{ name: 'Moderator', value: `${userMention(interaction.user.id)} (${interaction.user.username})` },
									{ name: 'New Slowmode', value: seconds === 0 ? 'Disabled' : `${seconds}s` },
								],
								timestamp: true,
							}),
						).catch(() => null);

						return interaction.editReply(
							successReply(`Slowmode for <#${channel.id}> set to **${seconds === 0 ? 'Disabled' : `${seconds}s`}**.`),
						);
					} catch {
						return interaction.editReply(
							errorReply('Failed to modify slowmode. Make sure I have Manage Channels permission.'),
						);
					}
				} else {
					return interaction.editReply(errorReply('Slowmode is not supported in this channel type.'));
				}
			}

			// ── Note Button ────────────────────────────────────────────────────────
			if (action === 'note') {
				const modal = new ModalBuilder()
					.setCustomId(`ctx:note:${targetId}`)
					.setTitle('Add Moderator Note')
					.addComponents(
						new ActionRowBuilder<TextInputBuilder>().addComponents(
							new TextInputBuilder()
								.setCustomId('note')
								.setLabel('Note content')
								.setStyle(TextInputStyle.Paragraph)
								.setRequired(true)
								.setMaxLength(500),
						),
					);
				return interaction.showModal(modal);
			}

			// ── Copy ID Button ─────────────────────────────────────────────────────
			if (action === 'copy_id') {
				return interaction.reply({ content: targetId, flags: MessageFlags.Ephemeral });
			}
		}

		// ── Modal submit handler ─────────────────────────────────────────────────
		if (interaction.isModalSubmit() && interaction.customId.startsWith('mod_modal:')) {
			const [, action, targetId] = interaction.customId.split(':');

			if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
				// biome-ignore lint/suspicious/noExplicitAny: CV2 flag type gap between reply/editReply
				return interaction.reply(errorReply('You do not have permission to use moderation actions.') as any);
			}

			await interaction.deferReply({ flags: MessageFlags.Ephemeral });

			const guild = interaction.guild;

			// ── Warn ──────────────────────────────────────────────────────────────
			if (action === 'warn') {
				const reason = interaction.fields.getTextInputValue('reason').trim();
				const target = await interaction.client.users.fetch(targetId).catch(() => null);
				if (!target) return interaction.editReply(errorReply('Could not find that user.'));

				if (target.id === interaction.user.id) return interaction.editReply(errorReply('You cannot warn yourself.'));
				if (target.bot) return interaction.editReply(errorReply('You cannot warn a bot.'));

				const member = guild.members.cache.get(target.id);
				if (member) {
					const h = checkHierarchy(interaction.member, member);
					if (!h.ok) return interaction.editReply(errorReply(h.reason));
				}

				const infraction = await createInfraction({
					guildId: guild.id,
					userId: target.id,
					moderatorId: interaction.user.id,
					type: 'warn',
					reason,
				});

				await dispatchModLog({
					guild,
					targetUser: target,
					moderator: interaction.user,
					type: 'warn',
					reason,
					caseId: infraction.caseId,
				});

				if (member) {
					const dm = makeContainer({ color: Colors.Warning, header: `You received a warning in ${guild.name}` });
					dm.addTextDisplayComponents(
						new TextDisplayBuilder().setContent(`**Reason** ${reason}\n-# Case \`${infraction.caseId}\``),
					);
					await member.send({ components: [dm], flags: CV2_FLAG }).catch(() => null);
				}

				const escalated = await applyWarnEscalation(guild, target, interaction.client, infraction.caseId);

				return interaction.editReply(
					successReply(
						`**${target.username}** has been warned. Case \`${infraction.caseId}\`.${escalated ? `\n⚖️ Auto-escalation: ${escalated}.` : ''}`,
					),
				);
			}

			// ── Kick ─────────────────────────────────────────────────────────────
			if (action === 'kick') {
				const reason = interaction.fields.getTextInputValue('reason').trim();

				if (!interaction.member.permissions.has(PermissionFlagsBits.KickMembers)) {
					return interaction.editReply(errorReply('You do not have permission to kick members.'));
				}

				const member = await guild.members.fetch(targetId).catch(() => null);
				if (!member) return interaction.editReply(errorReply('That user is not in this server.'));

				if (!member.kickable) return interaction.editReply(errorReply('I cannot kick this user.'));
				if (member.id === interaction.user.id) return interaction.editReply(errorReply('You cannot kick yourself.'));

				const h = checkHierarchy(interaction.member, member);
				if (!h.ok) return interaction.editReply(errorReply(h.reason));

				try {
					const dm = makeContainer({ color: Colors.Moderation, header: `You have been kicked from ${guild.name}` });
					dm.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Reason** ${reason}`));
					await member.send({ components: [dm], flags: CV2_FLAG }).catch(() => null);

					await member.kick(`[${interaction.user.username}] ${reason}`);

					const infraction = await createInfraction({
						guildId: guild.id,
						userId: member.id,
						moderatorId: interaction.user.id,
						type: 'kick',
						reason,
					});

					await dispatchModLog({
						guild,
						targetUser: member.user,
						moderator: interaction.user,
						type: 'kick',
						reason,
						caseId: infraction.caseId,
					});

					return interaction.editReply(
						successReply(`**${member.user.username}** has been kicked. Case \`${infraction.caseId}\`.`),
					);
				} catch {
					return interaction.editReply(errorReply('Failed to kick the user.'));
				}
			}

			// ── Timeout ───────────────────────────────────────────────────────────
			if (action === 'timeout') {
				const durationKey = interaction.fields.getTextInputValue('duration').trim().toLowerCase();
				const reason = interaction.fields.getTextInputValue('reason').trim();
				const durationMs = DURATION_PRESETS[durationKey];

				if (!durationMs) {
					return interaction.editReply(
						errorReply(`Invalid duration. Use one of: ${Object.keys(DURATION_PRESETS).join(', ')}`),
					);
				}

				const member = await guild.members.fetch(targetId).catch(() => null);
				if (!member) return interaction.editReply(errorReply('That user is not in this server.'));

				if (!member.moderatable) return interaction.editReply(errorReply('I cannot timeout this user.'));
				if (member.id === interaction.user.id) return interaction.editReply(errorReply('You cannot timeout yourself.'));

				const h = checkHierarchy(interaction.member, member);
				if (!h.ok) return interaction.editReply(errorReply(h.reason));

				try {
					await member.timeout(durationMs, `[${interaction.user.username}] ${reason}`);

					const infraction = await createInfraction({
						guildId: guild.id,
						userId: member.id,
						moderatorId: interaction.user.id,
						type: 'timeout',
						reason,
						duration: durationMs,
					});

					await dispatchModLog({
						guild,
						targetUser: member.user,
						moderator: interaction.user,
						type: 'timeout',
						reason,
						duration: durationMs,
						caseId: infraction.caseId,
					});

					return interaction.editReply(
						successReply(
							`**${member.user.username}** timed out for **${DURATION_LABELS[durationKey]}**. Case \`${infraction.caseId}\`.`,
						),
					);
				} catch {
					return interaction.editReply(errorReply('Failed to timeout the user.'));
				}
			}

			// ── Ban ───────────────────────────────────────────────────────────────
			if (action === 'ban') {
				const reason = interaction.fields.getTextInputValue('reason').trim();
				const durationStr = interaction.fields.getTextInputValue('duration').trim();
				const deleteDaysRaw = interaction.fields.getTextInputValue('delete_days').trim();
				const deleteDays = Math.min(7, Math.max(0, Number.parseInt(deleteDaysRaw, 10) || 0));

				let durationMs: number | undefined;
				if (durationStr) {
					const parsed = parseDuration(durationStr);
					if (!parsed) return interaction.editReply(errorReply('Invalid duration. Use formats like `7d`, `24h`.'));
					const maxMs = 28 * 24 * 60 * 60 * 1000;
					if (parsed > maxMs) return interaction.editReply(errorReply('Max ban duration is 28 days.'));
					durationMs = parsed;
				}

				if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
					return interaction.editReply(errorReply('You do not have permission to ban members.'));
				}

				const target = await interaction.client.users.fetch(targetId).catch(() => null);
				if (!target) return interaction.editReply(errorReply('Could not find that user.'));

				const member = guild.members.cache.get(target.id);
				if (member) {
					if (!member.bannable) return interaction.editReply(errorReply('I cannot ban this user.'));
					if (member.id === interaction.user.id) return interaction.editReply(errorReply('You cannot ban yourself.'));
					const h = checkHierarchy(interaction.member, member);
					if (!h.ok) return interaction.editReply(errorReply(h.reason));
				}

				try {
					const banLabel = durationMs
						? `temporarily banned for **${humanDuration(durationMs)}**`
						: 'permanently banned';
					const dm = makeContainer({ color: Colors.Error, header: `You have been banned from ${guild.name}` });
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
					});

					const durationNote = durationMs ? ` for **${humanDuration(durationMs)}**` : ' permanently';
					return interaction.editReply(
						successReply(`**${target.username}** has been banned${durationNote}. Case \`${infraction.caseId}\`.`),
					);
				} catch {
					return interaction.editReply(errorReply('Failed to ban the user.'));
				}
			}

			// ── Case Edit Modal Submit ────────────────────────────────────────────
			if (action === 'case_edit') {
				const caseId = targetId;
				const reason = interaction.fields.getTextInputValue('reason').trim();
				const guild = interaction.guild;

				const infraction = await getInfractionByCase(guild.id, caseId);
				if (!infraction) return interaction.editReply(errorReply(`No case found with ID \`${caseId}\`.`));

				const { updateInfractionReason } = await import('../../lib/ModerationUtil.js');
				await updateInfractionReason(guild.id, caseId, reason, interaction.user.id);

				// DM target user when their infraction reason is updated
				const targetUser = await interaction.client.users.fetch(infraction.userId).catch(() => null);
				if (targetUser) {
					const dm = makeContainer({ color: Colors.Warning, header: `Infraction Reason Updated in ${guild.name}` });
					dm.addTextDisplayComponents(
						new TextDisplayBuilder().setContent(
							`The reason for your infraction (Case \`${caseId}\`) has been updated by a moderator.\n**New Reason:** ${reason}`,
						),
					);
					const member = guild.members.cache.get(targetUser.id);
					if (member) {
						await member.send({ components: [dm], flags: CV2_FLAG }).catch(() => null);
					}
				}

				return interaction.editReply(successReply(`Case \`${caseId}\` reason updated.\n**New reason:** ${reason}`));
			}
		}

		// ── String Select Menu handler ───────────────────────────────────────────
		if (
			interaction.isStringSelectMenu() &&
			(interaction.customId === 'mod:untimeout_select' ||
				interaction.customId === 'mod:sticky_clear_select' ||
				interaction.customId.startsWith('mod:stats_inspect:'))
		) {
			if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
				return interaction.reply(errorReply('You do not have permission to perform this action.') as any);
			}

			if (interaction.customId === 'mod:untimeout_select') {
				await interaction.deferUpdate();
			} else {
				await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			}

			if (interaction.customId === 'mod:untimeout_select') {
				const targetId = interaction.values[0];
				const member = await interaction.guild.members.fetch(targetId).catch(() => null);
				if (!member) return interaction.followUp(errorReply('Could not find that member.') as any);

				const h = checkHierarchy(interaction.member, member);
				if (!h.ok) return interaction.followUp(errorReply(h.reason) as any);

				if (!member.communicationDisabledUntilTimestamp || member.communicationDisabledUntilTimestamp < Date.now()) {
					return interaction.followUp(errorReply('This user is not currently timed out.') as any);
				}

				try {
					await member.timeout(null, `[${interaction.user.username}] Lifted via active timeouts dropdown`);

					const infraction = await createInfraction({
						guildId: interaction.guild.id,
						userId: targetId,
						moderatorId: interaction.user.id,
						type: 'untimeout',
						reason: 'Lifted via active timeouts dropdown',
					});

					await dispatchModLog({
						guild: interaction.guild,
						targetUser: member.user,
						moderator: interaction.user,
						type: 'untimeout',
						reason: 'Lifted via active timeouts dropdown',
						caseId: infraction.caseId,
					});

					await interaction.editReply((await buildActiveTimeoutsPage(interaction.guild, 0)) as any);
					return interaction.followUp(successReply(`Timeout removed from **${member.user.username}**.`) as any);
				} catch {
					return interaction.followUp(errorReply('Failed to remove the timeout.') as any);
				}
			}

			if (interaction.customId === 'mod:sticky_clear_select') {
				const channelId = interaction.values[0];
				const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
				if (!channel || !channel.isTextBased()) {
					return interaction.editReply(errorReply('Channel not found or is not text-based.'));
				}

				const row = await db.query.stickyMessages.findFirst({
					where: eq(schema.stickyMessages.channelId, channel.id),
				});

				if (!row) {
					return interaction.editReply(warningReply(`No sticky message found in <#${channel.id}>.`));
				}

				if (row.lastMessageId) {
					const msg = await (channel as any).messages.fetch(row.lastMessageId).catch(() => null);
					await msg?.delete().catch(() => null);
				}

				await db.delete(schema.stickyMessages).where(eq(schema.stickyMessages.channelId, channel.id));

				return interaction.editReply(successReply(`Sticky message cleared from <#${channel.id}>.`));
			}

			if (interaction.customId.startsWith('mod:stats_inspect:')) {
				const timeframe = interaction.customId.split(':')[2];
				const modId = interaction.values[0];

				const member = await interaction.guild.members.fetch(modId).catch(() => null);
				if (!member) return interaction.editReply(errorReply('Could not find that moderator.'));

				let limitDate: Date | null = null;
				if (timeframe === '7d') {
					limitDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
				} else if (timeframe === '30d') {
					limitDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
				}

				const conditions = [
					eq(schema.infractions.guildId, interaction.guild.id),
					eq(schema.infractions.moderatorId, modId),
				];
				if (limitDate) {
					conditions.push(gte(schema.infractions.createdAt, limitDate));
				}

				const rows = await db
					.select()
					.from(schema.infractions)
					.where(and(...conditions));

				const counts: Record<string, number> = {};
				for (const row of rows) {
					counts[row.type] = (counts[row.type] ?? 0) + 1;
				}

				const tfLabel = timeframe === '7d' ? 'Past 7 days' : timeframe === '30d' ? 'Past 30 days' : 'Lifetime';
				const c = makeContainer({ color: Colors.Info, header: `Mod Stats (${tfLabel}) — ${member.user.username}` });
				c.addSeparatorComponents(separator());

				if (rows.length === 0) {
					c.addTextDisplayComponents(
						new TextDisplayBuilder().setContent('No recorded actions for this moderator in this timeframe.'),
					);
				} else {
					const lines = Object.entries(counts)
						.sort(([, a], [, b]) => b - a)
						.map(([type, n]) => `**${type.charAt(0).toUpperCase() + type.slice(1)}s:** ${n}`)
						.join('\n');
					c.addTextDisplayComponents(
						new TextDisplayBuilder().setContent(`${userMention(modId)}\n\n${lines}\n\n**Total:** ${rows.length}`),
					);
				}

				return interaction.editReply({ components: [c], flags: CV2_FLAG });
			}
		}
	}
}
