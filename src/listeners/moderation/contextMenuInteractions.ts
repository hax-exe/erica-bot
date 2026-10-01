import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Events, type Interaction, MessageFlags, PermissionFlagsBits, TextDisplayBuilder } from 'discord.js';
import { isBotBlacklisted } from '../../lib/BlacklistUtil.js';
import { Colors, CV2_FLAG, errorReply, makeContainer, successReply } from '../../lib/components.js';
import {
	applyWarnEscalation,
	checkHierarchy,
	clearTempbans,
	createInfraction,
	createNote,
	dispatchModLog,
} from '../../lib/ModerationUtil.js';
import { humanDuration, parseDuration } from '../../lib/parseDuration.js';

@ApplyOptions<Listener.Options>({
	name: 'moderationContextMenuInteractions',
	event: Events.InteractionCreate,
})
export class ModerationContextMenuListener extends Listener<typeof Events.InteractionCreate> {
	public override async run(interaction: Interaction) {
		if (!interaction.isModalSubmit()) return;
		if (!interaction.customId.startsWith('ctx:')) return;
		if (!interaction.inCachedGuild()) return;
		if (await isBotBlacklisted(interaction.user.id)) return;

		// Custom ID: ctx:<action>:<targetId>[:<messageId>] — the action names the variant.
		const parts = interaction.customId.split(':');
		const action = parts[1];
		const targetId = parts[2];
		const messageId = parts[3]; // only present for delwarn, deltimeout, delban
		const guild = interaction.guild;

		// Ban/kick variants need that specific permission (e.g. "Delete & Ban" is registered for Ban Members),
		// so Ban- or Kick-only moderators aren't turned away for lacking Moderate Members.
		const requiredPermission =
			action === 'ban' || action === 'delban'
				? PermissionFlagsBits.BanMembers
				: action === 'kick'
					? PermissionFlagsBits.KickMembers
					: PermissionFlagsBits.ModerateMembers;
		if (!interaction.memberPermissions.has(requiredPermission)) {
			return interaction.reply({
				content: 'You do not have permission to use this moderation action.',
				flags: MessageFlags.Ephemeral,
			});
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		// ── Warn & Delwarn ─────────────────────────────────────────────────────────

		if (action === 'warn' || action === 'delwarn') {
			const reason = interaction.fields.getTextInputValue('reason').trim();
			const target = await interaction.client.users.fetch(targetId).catch(() => null);
			if (!target) return interaction.editReply(errorReply('Could not find that user.'));

			if (target.id === interaction.user.id) {
				return interaction.editReply(errorReply('You cannot warn yourself.'));
			}
			if (target.bot) {
				return interaction.editReply(errorReply('You cannot warn a bot.'));
			}

			// Fetch (not cache-get) so an uncached member can't skip the hierarchy check or the DM.
			const member = await guild.members.fetch(target.id).catch(() => null);
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

			let deletedMsg = false;
			if (action === 'delwarn' && messageId) {
				const channel = interaction.channel;
				if (channel && channel.isTextBased()) {
					const msg = await channel.messages.fetch(messageId).catch(() => null);
					if (msg) {
						await msg.delete().catch(() => null);
						deletedMsg = true;
					}
				}
			}

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
					`**${target.username}** has been warned. Case \`${infraction.caseId}\`.${deletedMsg ? '\n🗑️ **Message deleted.**' : ''}${escalated ? `\n⚖️ Auto-escalation: ${escalated}.` : ''}`,
				),
			);
		}

		// ── Delete & Timeout ────────────────────────────────────────────────────────

		if (action === 'deltimeout') {
			const durationStr = interaction.fields.getTextInputValue('duration').trim();
			const reason = interaction.fields.getTextInputValue('reason').trim() || 'No reason provided';
			const target = guild.members.cache.get(targetId) ?? (await guild.members.fetch(targetId).catch(() => null));
			if (!target) return interaction.editReply(errorReply('That user is not in this server.'));

			const durationMs = parseDuration(durationStr);
			if (!durationMs) {
				return interaction.editReply(errorReply('Invalid duration format. Use formats like `10m`, `2h`, `1d`.'));
			}
			const maxMs = 28 * 24 * 60 * 60 * 1000;
			if (durationMs > maxMs) return interaction.editReply(errorReply('Max timeout duration is 28 days.'));

			if (!target.moderatable) {
				return interaction.editReply(errorReply('I cannot timeout this user (missing permissions or higher role).'));
			}
			if (target.id === interaction.user.id) {
				return interaction.editReply(errorReply('You cannot timeout yourself.'));
			}
			const h = checkHierarchy(interaction.member, target);
			if (!h.ok) return interaction.editReply(errorReply(h.reason));

			try {
				const dm = makeContainer({ color: Colors.Moderation, header: `You have been timed out in ${guild.name}` });
				dm.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(`**Reason** ${reason}\n-# Duration: **${humanDuration(durationMs)}**`),
				);
				await target.send({ components: [dm], flags: CV2_FLAG }).catch(() => null);

				await target.timeout(durationMs, `[${interaction.user.username}] [Delete & Timeout] ${reason}`);

				const infraction = await createInfraction({
					guildId: guild.id,
					userId: target.id,
					moderatorId: interaction.user.id,
					type: 'timeout',
					reason: `[Delete & Timeout] ${reason}`,
					duration: durationMs,
				});

				let deletedMsg = false;
				if (messageId) {
					const channel = interaction.channel;
					if (channel && channel.isTextBased()) {
						const msg = await channel.messages.fetch(messageId).catch(() => null);
						if (msg) {
							await msg.delete().catch(() => null);
							deletedMsg = true;
						}
					}
				}

				await dispatchModLog({
					guild,
					targetUser: target.user,
					moderator: interaction.user,
					type: 'timeout',
					reason: `[Delete & Timeout] ${reason}`,
					caseId: infraction.caseId,
					duration: durationMs,
				});

				return interaction.editReply(
					successReply(
						`**${target.user.username}** has been timed out for **${humanDuration(durationMs)}**. Case \`${infraction.caseId}\`.${deletedMsg ? '\n🗑️ **Message deleted.**' : ''}`,
					),
				);
			} catch (err) {
				this.container.logger.error(err);
				return interaction.editReply(errorReply('Failed to timeout the user.'));
			}
		}

		// ── Delete & Ban ───────────────────────────────────────────────────────────

		if (action === 'delban') {
			const reason = interaction.fields.getTextInputValue('reason').trim() || 'No reason provided';
			const deleteDaysRaw = interaction.fields.getTextInputValue('delete_days').trim();
			const deleteDays = Math.min(7, Math.max(0, Number.parseInt(deleteDaysRaw, 10) || 0));

			const target = await interaction.client.users.fetch(targetId).catch(() => null);
			if (!target) return interaction.editReply(errorReply('Could not find that user.'));

			// Fetch (not cache-get) so an uncached member can't skip the hierarchy check.
			const member = await guild.members.fetch(target.id).catch(() => null);
			if (member) {
				if (!member.bannable) {
					return interaction.editReply(errorReply('I cannot ban this user (missing permissions or higher role).'));
				}
				if (member.id === interaction.user.id) {
					return interaction.editReply(errorReply('You cannot ban yourself.'));
				}
				const h = checkHierarchy(interaction.member, member);
				if (!h.ok) return interaction.editReply(errorReply(h.reason));
			}

			try {
				const dm = makeContainer({ color: Colors.Error, header: `You have been banned from ${guild.name}` });
				dm.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(`**Reason** ${reason}\n-# You were permanently banned.`),
				);
				await target.send({ components: [dm], flags: CV2_FLAG }).catch(() => null);

				await guild.bans.create(target.id, {
					reason: `[${interaction.user.username}] [Delete & Ban] ${reason}`,
					deleteMessageSeconds: deleteDays * 86400,
				});
				// A permanent ban supersedes any pending temp-ban expiry.
				await clearTempbans(guild.id, target.id);

				const infraction = await createInfraction({
					guildId: guild.id,
					userId: target.id,
					moderatorId: interaction.user.id,
					type: 'ban',
					reason: `[Delete & Ban] ${reason}`,
				});

				let deletedMsg = false;
				if (messageId) {
					const channel = interaction.channel;
					if (channel && channel.isTextBased()) {
						const msg = await channel.messages.fetch(messageId).catch(() => null);
						if (msg) {
							await msg.delete().catch(() => null);
							deletedMsg = true;
						}
					}
				}

				await dispatchModLog({
					guild,
					targetUser: target,
					moderator: interaction.user,
					type: 'ban',
					reason: `[Delete & Ban] ${reason}`,
					caseId: infraction.caseId,
				});

				return interaction.editReply(
					successReply(
						`**${target.username}** has been banned. Case \`${infraction.caseId}\`.${deletedMsg ? '\n🗑️ **Message deleted.**' : ''}`,
					),
				);
			} catch (err) {
				this.container.logger.error(err);
				return interaction.editReply(errorReply('Failed to ban the user.'));
			}
		}

		// ── Kick ───────────────────────────────────────────────────────────────────

		if (action === 'kick') {
			const reason = interaction.fields.getTextInputValue('reason').trim() || 'No reason provided';
			const target = guild.members.cache.get(targetId) ?? (await guild.members.fetch(targetId).catch(() => null));
			if (!target) return interaction.editReply(errorReply('That user is not in this server.'));

			if (!target.kickable) {
				return interaction.editReply(errorReply('I cannot kick this user (missing permissions or higher role).'));
			}
			if (target.id === interaction.user.id) {
				return interaction.editReply(errorReply('You cannot kick yourself.'));
			}
			const h = checkHierarchy(interaction.member, target);
			if (!h.ok) return interaction.editReply(errorReply(h.reason));

			try {
				await target.kick(`[${interaction.user.username}] ${reason}`);

				const infraction = await createInfraction({
					guildId: guild.id,
					userId: target.id,
					moderatorId: interaction.user.id,
					type: 'kick',
					reason,
				});

				await dispatchModLog({
					guild,
					targetUser: target.user,
					moderator: interaction.user,
					type: 'kick',
					reason,
					caseId: infraction.caseId,
				});

				return interaction.editReply(
					successReply(`**${target.user.username}** has been kicked. Case \`${infraction.caseId}\`.`),
				);
			} catch (err) {
				this.container.logger.error(err);
				return interaction.editReply(errorReply('Failed to kick the user.'));
			}
		}

		// ── Ban ────────────────────────────────────────────────────────────────────

		if (action === 'ban') {
			const reason = interaction.fields.getTextInputValue('reason').trim() || 'No reason provided';
			const deleteDaysRaw = interaction.fields.getTextInputValue('delete_days').trim();
			const deleteDays = Math.min(7, Math.max(0, Number.parseInt(deleteDaysRaw, 10) || 0));

			const target = await interaction.client.users.fetch(targetId).catch(() => null);
			if (!target) return interaction.editReply(errorReply('Could not find that user.'));

			// Fetch (not cache-get) so an uncached member can't skip the hierarchy check.
			const member = await guild.members.fetch(target.id).catch(() => null);
			if (member) {
				if (!member.bannable) {
					return interaction.editReply(errorReply('I cannot ban this user (missing permissions or higher role).'));
				}
				if (member.id === interaction.user.id) {
					return interaction.editReply(errorReply('You cannot ban yourself.'));
				}
				const h = checkHierarchy(interaction.member, member);
				if (!h.ok) return interaction.editReply(errorReply(h.reason));
			}

			try {
				await guild.bans.create(target.id, {
					reason: `[${interaction.user.username}] ${reason}`,
					deleteMessageSeconds: deleteDays * 86400,
				});
				// A permanent ban supersedes any pending temp-ban expiry.
				await clearTempbans(guild.id, target.id);

				const infraction = await createInfraction({
					guildId: guild.id,
					userId: target.id,
					moderatorId: interaction.user.id,
					type: 'ban',
					reason,
				});

				await dispatchModLog({
					guild,
					targetUser: target,
					moderator: interaction.user,
					type: 'ban',
					reason,
					caseId: infraction.caseId,
				});

				return interaction.editReply(
					successReply(`**${target.username}** has been banned. Case \`${infraction.caseId}\`.`),
				);
			} catch (err) {
				this.container.logger.error(err);
				return interaction.editReply(errorReply('Failed to ban the user.'));
			}
		}

		// ── Note ───────────────────────────────────────────────────────────────────

		if (action === 'note') {
			const content = interaction.fields.getTextInputValue('note').trim();
			const target = await interaction.client.users.fetch(targetId).catch(() => null);
			if (!target) return interaction.editReply(errorReply('Could not find that user.'));

			const note = await createNote(guild.id, target.id, interaction.user.id, content);

			return interaction.editReply(
				successReply(`Note **#${note.id}** added for **${target.username}** (\`${target.id}\`).`),
			);
		}

		// Unknown/outdated `ctx:` action — the reply is already deferred, so it must be edited.
		return interaction.editReply(errorReply('This moderation action is no longer available.'));
	}
}
