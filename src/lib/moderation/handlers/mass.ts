import { MessageFlags, PermissionFlagsBits, TextDisplayBuilder, userMention } from 'discord.js';
import { Colors, CV2_FLAG, errorReply, logContainer, makeContainer } from '../../../lib/components.js';
import { sendModLog } from '../../../lib/LoggingUtil.js';
import { applyWarnEscalation, checkHierarchy, createInfraction, dispatchModLog } from '../../../lib/ModerationUtil.js';
import { humanDuration, parseDuration } from '../../../lib/parseDuration.js';

export class MassHandler {
	// Helper to extract unique 17-19 digit IDs
	private extractIds(input: string): string[] {
		const rawIds = input.match(/\b\d{17,19}\b/g) || [];
		return [...new Set(rawIds)];
	}

	public async runBan(interaction: any) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
			return interaction.editReply(errorReply('You need the **Ban Members** permission to use this subcommand.'));
		}

		const usersInput = interaction.options.getString('users', true);
		const reason = interaction.options.getString('reason') ?? 'Massban - No reason provided';
		const deleteDays = interaction.options.getInteger('delete_days') ?? 0;
		const guild = interaction.guild;

		const targetIds = this.extractIds(usersInput);
		if (targetIds.length === 0) return interaction.editReply(errorReply('No valid User IDs found in your input.'));
		if (targetIds.length > 50)
			return interaction.editReply(errorReply('You can only massban up to 50 users at a time.'));

		let bannedCount = 0;
		let failedCount = 0;
		const auditReason = `[${interaction.user.username}] Massban — ${reason}`;

		for (const id of targetIds) {
			if (id === interaction.user.id || id === interaction.client.user.id) {
				failedCount++;
				continue;
			}

			try {
				const member = await guild.members.fetch(id).catch(() => null);
				if (member && !member.bannable) {
					failedCount++;
					continue;
				}

				await guild.bans.create(id, {
					reason: auditReason,
					deleteMessageSeconds: deleteDays * 86400,
				});

				await createInfraction({
					guildId: guild.id,
					userId: id,
					moderatorId: interaction.user.id,
					type: 'ban',
					reason: `Massban: ${reason}`,
				});

				bannedCount++;
			} catch {
				failedCount++;
			}
		}

		if (bannedCount > 0) {
			await sendModLog(
				guild,
				logContainer({
					title: 'Mass Ban Executed',
					color: Colors.Error,
					fields: [
						{ name: 'Users Banned', value: `${bannedCount}` },
						{ name: 'Failed', value: `${failedCount}` },
						{ name: 'Reason', value: reason },
						{ name: 'Moderator', value: `${userMention(interaction.user.id)} (${interaction.user.username})` },
					],
					timestamp: true,
				}),
			).catch(() => null);
		}

		const c = makeContainer({ color: Colors.Success, header: 'Massban Complete' });
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`Successfully banned **${bannedCount}** user(s).\nFailed to ban **${failedCount}** user(s).`,
			),
		);
		return interaction.editReply({ components: [c] });
	}

	public async runKick(interaction: any) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		if (!interaction.member.permissions.has(PermissionFlagsBits.KickMembers)) {
			return interaction.editReply(errorReply('You need the **Kick Members** permission to use this subcommand.'));
		}

		const usersInput = interaction.options.getString('users', true);
		const reason = interaction.options.getString('reason') ?? 'Masskick - No reason provided';
		const guild = interaction.guild;

		const targetIds = this.extractIds(usersInput);
		if (targetIds.length === 0) return interaction.editReply(errorReply('No valid User IDs found in your input.'));
		if (targetIds.length > 50)
			return interaction.editReply(errorReply('You can only masskick up to 50 users at a time.'));

		let kickedCount = 0;
		let failedCount = 0;
		const auditReason = `[${interaction.user.username}] Masskick — ${reason}`;

		for (const id of targetIds) {
			if (id === interaction.user.id || id === interaction.client.user.id) {
				failedCount++;
				continue;
			}

			try {
				const member = await guild.members.fetch(id).catch(() => null);
				if (!member || !member.kickable) {
					failedCount++;
					continue;
				}

				const h = checkHierarchy(interaction.member, member);
				if (!h.ok) {
					failedCount++;
					continue;
				}

				await member.kick(auditReason);

				await createInfraction({
					guildId: guild.id,
					userId: id,
					moderatorId: interaction.user.id,
					type: 'kick',
					reason: `Masskick: ${reason}`,
				});

				kickedCount++;
			} catch {
				failedCount++;
			}
		}

		if (kickedCount > 0) {
			await sendModLog(
				guild,
				logContainer({
					title: 'Mass Kick Executed',
					color: Colors.Moderation,
					fields: [
						{ name: 'Users Kicked', value: `${kickedCount}` },
						{ name: 'Failed', value: `${failedCount}` },
						{ name: 'Reason', value: reason },
						{ name: 'Moderator', value: `${userMention(interaction.user.id)} (${interaction.user.username})` },
					],
					timestamp: true,
				}),
			).catch(() => null);
		}

		const c = makeContainer({ color: Colors.Success, header: 'Masskick Complete' });
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`Successfully kicked **${kickedCount}** user(s).\nFailed to kick **${failedCount}** user(s).`,
			),
		);
		return interaction.editReply({ components: [c] });
	}

	public async runTimeout(interaction: any) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
			return interaction.editReply(errorReply('You need the **Moderate Members** permission to use this subcommand.'));
		}

		const usersInput = interaction.options.getString('users', true);
		const durationStr = interaction.options.getString('duration', true);
		const reason = interaction.options.getString('reason') ?? 'Mass timeout - No reason provided';
		const guild = interaction.guild;

		const durationMs = parseDuration(durationStr);
		if (!durationMs) {
			return interaction.editReply(errorReply('Invalid duration format. Use formats like `10m`, `2h`, `1d`.'));
		}
		const maxMs = 28 * 24 * 60 * 60 * 1000;
		if (durationMs > maxMs) return interaction.editReply(errorReply('Max timeout duration is 28 days.'));

		const targetIds = this.extractIds(usersInput);
		if (targetIds.length === 0) return interaction.editReply(errorReply('No valid User IDs found in your input.'));
		if (targetIds.length > 50)
			return interaction.editReply(errorReply('You can only mass timeout up to 50 users at a time.'));

		let timedOutCount = 0;
		let failedCount = 0;
		const auditReason = `[${interaction.user.username}] Masstimeout — ${reason}`;

		for (const id of targetIds) {
			if (id === interaction.user.id || id === interaction.client.user.id) {
				failedCount++;
				continue;
			}

			try {
				const member = await guild.members.fetch(id).catch(() => null);
				if (!member || !member.moderatable) {
					failedCount++;
					continue;
				}

				const h = checkHierarchy(interaction.member, member);
				if (!h.ok) {
					failedCount++;
					continue;
				}

				await member.timeout(durationMs, auditReason);

				await createInfraction({
					guildId: guild.id,
					userId: id,
					moderatorId: interaction.user.id,
					type: 'timeout',
					reason: `Masstimeout: ${reason}`,
					duration: durationMs,
				});

				timedOutCount++;
			} catch {
				failedCount++;
			}
		}

		if (timedOutCount > 0) {
			await sendModLog(
				guild,
				logContainer({
					title: 'Mass Timeout Executed',
					color: Colors.Moderation,
					fields: [
						{ name: 'Users Timed Out', value: `${timedOutCount}` },
						{ name: 'Failed', value: `${failedCount}` },
						{ name: 'Duration', value: humanDuration(durationMs) },
						{ name: 'Reason', value: reason },
						{ name: 'Moderator', value: `${userMention(interaction.user.id)} (${interaction.user.username})` },
					],
					timestamp: true,
				}),
			).catch(() => null);
		}

		const c = makeContainer({ color: Colors.Success, header: 'Mass Timeout Complete' });
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`Successfully timed out **${timedOutCount}** user(s) for **${humanDuration(durationMs)}**.\nFailed to timeout **${failedCount}** user(s).`,
			),
		);
		return interaction.editReply({ components: [c] });
	}

	public async runUnban(interaction: any) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
			return interaction.editReply(errorReply('You need the **Ban Members** permission to use this subcommand.'));
		}

		const usersInput = interaction.options.getString('users', true);
		const reason = interaction.options.getString('reason') ?? 'Mass unban - No reason provided';
		const guild = interaction.guild;

		const targetIds = this.extractIds(usersInput);
		if (targetIds.length === 0) return interaction.editReply(errorReply('No valid User IDs found in your input.'));
		if (targetIds.length > 50)
			return interaction.editReply(errorReply('You can only mass unban up to 50 users at a time.'));

		let unbannedCount = 0;
		let failedCount = 0;
		const auditReason = `[${interaction.user.username}] Massunban — ${reason}`;

		for (const id of targetIds) {
			try {
				await guild.bans.remove(id, auditReason);

				await createInfraction({
					guildId: guild.id,
					userId: id,
					moderatorId: interaction.user.id,
					type: 'unban',
					reason: `Massunban: ${reason}`,
				});

				unbannedCount++;
			} catch {
				failedCount++;
			}
		}

		if (unbannedCount > 0) {
			await sendModLog(
				guild,
				logContainer({
					title: 'Mass Unban Executed',
					color: Colors.Success,
					fields: [
						{ name: 'Users Unbanned', value: `${unbannedCount}` },
						{ name: 'Failed', value: `${failedCount}` },
						{ name: 'Reason', value: reason },
						{ name: 'Moderator', value: `${userMention(interaction.user.id)} (${interaction.user.username})` },
					],
					timestamp: true,
				}),
			).catch(() => null);
		}

		const c = makeContainer({ color: Colors.Success, header: 'Mass Unban Complete' });
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`Successfully unbanned **${unbannedCount}** user(s).\nFailed to unban **${failedCount}** user(s).`,
			),
		);
		return interaction.editReply({ components: [c] });
	}

	public async runUntimeout(interaction: any) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
			return interaction.editReply(errorReply('You need the **Moderate Members** permission to use this subcommand.'));
		}

		const usersInput = interaction.options.getString('users', true);
		const reason = interaction.options.getString('reason') ?? 'Mass untimeout - No reason provided';
		const guild = interaction.guild;

		const targetIds = this.extractIds(usersInput);
		if (targetIds.length === 0) return interaction.editReply(errorReply('No valid User IDs found in your input.'));
		if (targetIds.length > 50)
			return interaction.editReply(errorReply('You can only mass untimeout up to 50 users at a time.'));

		let untimedOutCount = 0;
		let failedCount = 0;
		const auditReason = `[${interaction.user.username}] Massuntimeout — ${reason}`;

		for (const id of targetIds) {
			try {
				const member = await guild.members.fetch(id).catch(() => null);
				if (!member || !member.communicationDisabledUntilTimestamp) {
					failedCount++;
					continue;
				}

				const h = checkHierarchy(interaction.member, member);
				if (!h.ok) {
					failedCount++;
					continue;
				}

				await member.timeout(null, auditReason);

				await createInfraction({
					guildId: guild.id,
					userId: id,
					moderatorId: interaction.user.id,
					type: 'untimeout',
					reason: `Massuntimeout: ${reason}`,
				});

				untimedOutCount++;
			} catch {
				failedCount++;
			}
		}

		if (untimedOutCount > 0) {
			await sendModLog(
				guild,
				logContainer({
					title: 'Mass Untimeout Executed',
					color: Colors.Success,
					fields: [
						{ name: 'Users Untimed Out', value: `${untimedOutCount}` },
						{ name: 'Failed', value: `${failedCount}` },
						{ name: 'Reason', value: reason },
						{ name: 'Moderator', value: `${userMention(interaction.user.id)} (${interaction.user.username})` },
					],
					timestamp: true,
				}),
			).catch(() => null);
		}

		const c = makeContainer({ color: Colors.Success, header: 'Mass Untimeout Complete' });
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`Successfully removed timeout from **${untimedOutCount}** user(s).\nFailed to remove timeout from **${failedCount}** user(s).`,
			),
		);
		return interaction.editReply({ components: [c] });
	}

	public async runWarn(interaction: any) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
			return interaction.editReply(errorReply('You need the **Moderate Members** permission to use this subcommand.'));
		}

		const usersInput = interaction.options.getString('users', true);
		const reason = interaction.options.getString('reason') ?? 'Masswarn - No reason provided';
		const guild = interaction.guild;

		const targetIds = this.extractIds(usersInput);
		if (targetIds.length === 0) return interaction.editReply(errorReply('No valid User IDs found in your input.'));
		if (targetIds.length > 50)
			return interaction.editReply(errorReply('You can only masswarn up to 50 users at a time.'));

		let warnedCount = 0;
		let failedCount = 0;

		for (const id of targetIds) {
			if (id === interaction.user.id || id === interaction.client.user.id) {
				failedCount++;
				continue;
			}

			try {
				const user = await interaction.client.users.fetch(id).catch(() => null);
				if (!user || user.bot) {
					failedCount++;
					continue;
				}

				const member = guild.members.cache.get(id);
				if (member) {
					const h = checkHierarchy(interaction.member, member);
					if (!h.ok) {
						failedCount++;
						continue;
					}
				}

				const infraction = await createInfraction({
					guildId: guild.id,
					userId: id,
					moderatorId: interaction.user.id,
					type: 'warn',
					reason: `Masswarn: ${reason}`,
				});

				await dispatchModLog({
					guild,
					targetUser: user,
					moderator: interaction.user,
					type: 'warn',
					reason: `Masswarn: ${reason}`,
					caseId: infraction.caseId,
				});

				if (member) {
					const dm = makeContainer({ color: Colors.Warning, header: `You received a warning in ${guild.name}` });
					dm.addTextDisplayComponents(
						new TextDisplayBuilder().setContent(`**Reason** Masswarn: ${reason}\n-# Case \`${infraction.caseId}\``),
					);
					await member.send({ components: [dm], flags: CV2_FLAG }).catch(() => null);
				}

				await applyWarnEscalation(guild, user, interaction.client, infraction.caseId);
				warnedCount++;
			} catch {
				failedCount++;
			}
		}

		if (warnedCount > 0) {
			await sendModLog(
				guild,
				logContainer({
					title: 'Mass Warn Executed',
					color: Colors.Warning,
					fields: [
						{ name: 'Users Warned', value: `${warnedCount}` },
						{ name: 'Failed', value: `${failedCount}` },
						{ name: 'Reason', value: reason },
						{ name: 'Moderator', value: `${userMention(interaction.user.id)} (${interaction.user.username})` },
					],
					timestamp: true,
				}),
			).catch(() => null);
		}

		const c = makeContainer({ color: Colors.Success, header: 'Masswarn Complete' });
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`Successfully warned **${warnedCount}** user(s).\nFailed to warn **${failedCount}** user(s).`,
			),
		);
		return interaction.editReply({ components: [c] });
	}
}
