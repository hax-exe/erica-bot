import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import {
	AuditLogEvent,
	channelMention,
	Events,
	type Guild,
	type GuildAuditLogsEntry,
	PermissionsBitField,
	roleMention,
	type User,
	userMention,
} from 'discord.js';
import { Colors, logContainer } from '../../lib/components.js';
import { formatUser, sendLog, sendModLog } from '../../lib/LoggingUtil.js';
import { createInfraction, dispatchModLog } from '../../lib/ModerationUtil.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';

// ─── Helpers ───────────────────────────────────────────────────────────────────

function executor(entry: GuildAuditLogsEntry): string {
	if (!entry.executorId) return 'Unknown';
	return formatUser(entry.executorId, entry.executor?.username);
}

function userTarget(entry: GuildAuditLogsEntry): string {
	const t = entry.target as any;
	const id = t?.id ?? entry.targetId;
	if (!id) return 'Unknown';
	return formatUser(id, t?.username);
}

function channelTarget(entry: GuildAuditLogsEntry): string {
	const t = entry.target as any;
	const id = t?.id ?? entry.targetId;
	if (!id) return 'Unknown';
	const name = t?.name ?? null;
	return name ? `${channelMention(id)} (${name})` : channelMention(id);
}

function roleTarget(entry: GuildAuditLogsEntry): string {
	const t = entry.target as any;
	const id = t?.id ?? entry.targetId;
	if (!id) return 'Unknown';
	const name = t?.name ?? null;
	return name ? `${roleMention(id)} (${name})` : roleMention(id);
}

function target(entry: GuildAuditLogsEntry): string {
	const t = entry.target as any;
	const id = t?.id ?? entry.targetId;
	if (!t && !id) return 'Unknown';
	if (t?.name) return `${t.name}${id ? ` (\`${id}\`)` : ''}`;
	if (id) return `\`${id}\``;
	return 'Unknown';
}

// ─── Listener ─────────────────────────────────────────────────────────────────

@ApplyOptions<Listener.Options>({
	name: 'auditLogLogging',
	event: Events.GuildAuditLogEntryCreate,
})
export class AuditLogListener extends Listener<typeof Events.GuildAuditLogEntryCreate> {
	public override async run(entry: GuildAuditLogsEntry, guild: Guild) {
		try {
			// Pre-fetch executor so username is available even if not in member cache
			if (entry.executorId && !entry.executor) {
				await guild.client.users.fetch(entry.executorId).catch(() => null);
			}

			// Pre-fetch target user if target is a User/Member and not fully cached
			if (entry.targetId && entry.targetType === 'User' && (!entry.target || !(entry.target as User).username)) {
				await guild.client.users.fetch(entry.targetId).catch(() => null);
			}

			// Mod actions (kick, ban, unban, timeout) are ALWAYS processed so that
			// externally-issued actions are recorded in the mod log even when the
			// general logging module is disabled.
			await this.handleExternalModAction(entry, guild);

			// All general log events require the logging module to be enabled.
			if (!(await isModuleEnabled(guild.id, 'logging'))) return;
			await this.handleGeneralLogEvent(entry, guild);
		} catch (err) {
			this.container.logger.error(`[auditLogLogging] Failed to process audit entry ${entry.action}:`, err);
		}
	}

	// ─── External mod action handler ────────────────────────────────────────────
	// Only processes events that were NOT executed by this bot (bot commands already
	// call dispatchModLog themselves). Creates an infraction record + mod log entry.

	private async handleExternalModAction(entry: GuildAuditLogsEntry, guild: Guild) {
		// Skip actions performed by this bot (already logged by the command)
		if (!entry.executorId || entry.executorId === guild.client.user.id) return;

		const reason = entry.reason ?? 'No reason provided';
		const mod: User = entry.executor ?? ({ id: entry.executorId, username: entry.executorId } as any);
		const targetUser =
			(entry.target as User | null) ??
			(entry.targetId ? ({ id: entry.targetId, username: `User \`${entry.targetId}\`` } as any) : null);

		switch (entry.action) {
			case AuditLogEvent.MemberKick: {
				if (!targetUser) return;
				const infraction = await createInfraction({
					guildId: guild.id,
					userId: targetUser.id,
					moderatorId: entry.executorId,
					type: 'kick',
					reason,
				});
				await dispatchModLog({ guild, targetUser, moderator: mod, type: 'kick', reason, caseId: infraction.caseId });
				return;
			}

			case AuditLogEvent.MemberBanAdd: {
				if (!targetUser) return;
				const infraction = await createInfraction({
					guildId: guild.id,
					userId: targetUser.id,
					moderatorId: entry.executorId,
					type: 'ban',
					reason,
				});
				await dispatchModLog({ guild, targetUser, moderator: mod, type: 'ban', reason, caseId: infraction.caseId });
				return;
			}

			case AuditLogEvent.MemberBanRemove: {
				if (!targetUser) return;
				const infraction = await createInfraction({
					guildId: guild.id,
					userId: targetUser.id,
					moderatorId: entry.executorId,
					type: 'unban',
					reason,
				});
				await dispatchModLog({ guild, targetUser, moderator: mod, type: 'unban', reason, caseId: infraction.caseId });
				return;
			}

			case AuditLogEvent.MemberUpdate: {
				if (!targetUser) return;
				const changes = entry.changes ?? [];
				const timeoutChange = changes.find((c) => c.key === 'communication_disabled_until');
				if (!timeoutChange) return;

				const isApplying = !!timeoutChange.new;
				if (isApplying) {
					const expiresMs = new Date(timeoutChange.new as string).getTime();
					const durationMs = Math.max(0, expiresMs - Date.now());
					const infraction = await createInfraction({
						guildId: guild.id,
						userId: targetUser.id,
						moderatorId: entry.executorId,
						type: 'timeout',
						reason,
						duration: durationMs > 0 ? durationMs : undefined,
					});
					await dispatchModLog({
						guild,
						targetUser,
						moderator: mod,
						type: 'timeout',
						reason,
						caseId: infraction.caseId,
						duration: durationMs > 0 ? durationMs : undefined,
					});
				} else {
					const untimeoutReason = reason === 'No reason provided' ? 'Timeout removed' : reason;
					const infraction = await createInfraction({
						guildId: guild.id,
						userId: targetUser.id,
						moderatorId: entry.executorId,
						type: 'untimeout',
						reason: untimeoutReason,
					});
					await dispatchModLog({
						guild,
						targetUser,
						moderator: mod,
						type: 'untimeout',
						reason: untimeoutReason,
						caseId: infraction.caseId,
					});
				}
				return;
			}
		}
	}

	// ─── General log event handler ───────────────────────────────────────────────
	// Only runs when isModuleEnabled('logging') is true (checked in run()).
	// Kick/ban/unban/timeout are intentionally absent — handled above.

	private async handleGeneralLogEvent(entry: GuildAuditLogsEntry, guild: Guild) {
		switch (entry.action) {
			// ── Member actions ───────────────────────────────────────────────────────

			case AuditLogEvent.MemberUpdate: {
				const changes = entry.changes ?? [];

				const nickChange = changes.find((c) => c.key === 'nick');
				if (nickChange) {
					const isSelfChange = entry.executorId === (entry.target as any)?.id;
					return sendLog(
						guild,
						logContainer({
							entry,
							title: 'Nickname Changed',
							color: Colors.Neutral,
							fields: [
								{ name: 'User', value: userTarget(entry) },
								{ name: 'Old Nickname', value: (nickChange.old as string | null) ?? '*(none)*' },
								{ name: 'New Nickname', value: (nickChange.new as string | null) ?? '*(none)*' },
								...(!isSelfChange ? [{ name: 'Changed By', value: executor(entry) }] : []),
							],
							timestamp: true,
						}),
					);
				}

				const muteChange = changes.find((c) => c.key === 'mute');
				if (muteChange) {
					return sendLog(
						guild,
						logContainer({
							entry,
							title: muteChange.new ? 'Member Server Muted' : 'Member Server Unmuted',
							color: muteChange.new ? Colors.Moderation : Colors.Success,
							fields: [
								{ name: 'User', value: userTarget(entry) },
								{ name: 'Changed By', value: executor(entry) },
							],
							timestamp: true,
						}),
					);
				}

				const deafenChange = changes.find((c) => c.key === 'deaf');
				if (deafenChange) {
					return sendLog(
						guild,
						logContainer({
							entry,
							title: deafenChange.new ? 'Member Server Deafened' : 'Member Server Undeafened',
							color: deafenChange.new ? Colors.Moderation : Colors.Success,
							fields: [
								{ name: 'User', value: userTarget(entry) },
								{ name: 'Changed By', value: executor(entry) },
							],
							timestamp: true,
						}),
					);
				}

				return null;
			}

			case AuditLogEvent.MemberPrune:
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'Members Pruned',
						color: Colors.Warning,
						fields: [
							{ name: 'Pruned By', value: executor(entry) },
							{ name: 'Inactive Days', value: String((entry.extra as any)?.deleteMemberDays ?? '?') },
							{ name: 'Members Removed', value: String((entry.extra as any)?.membersRemoved ?? '?') },
						],
						timestamp: true,
					}),
				);

			case AuditLogEvent.BotAdd:
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'Bot Added',
						color: Colors.Warning,
						fields: [
							{ name: 'Bot', value: userTarget(entry) },
							{ name: 'Added By', value: executor(entry) },
						],
						timestamp: true,
					}),
				);

			case AuditLogEvent.MemberRoleUpdate: {
				const changes = entry.changes ?? [];
				const added = changes.find((c) => c.key === '$add');
				const removed = changes.find((c) => c.key === '$remove');
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'Member Roles Updated',
						color: Colors.Info,
						fields: [
							{ name: 'User', value: userTarget(entry) },
							{ name: 'Changed By', value: executor(entry) },
							...(added?.new
								? [
										{
											name: 'Roles Added',
											value: (added.new as Array<{ id: string; name: string }>)
												.map((r) => roleMention(r.id))
												.join(', '),
										},
									]
								: []),
							...(removed?.new
								? [
										{
											name: 'Roles Removed',
											value: (removed.new as Array<{ id: string; name: string }>)
												.map((r) => roleMention(r.id))
												.join(', '),
										},
									]
								: []),
						],
						timestamp: true,
					}),
				);
			}

			// ── Channel actions ──────────────────────────────────────────────────────

			case AuditLogEvent.ChannelCreate: {
				const chId = (entry.target as any)?.id as string | undefined;
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'Channel Created',
						color: Colors.Success,
						fields: [
							{ name: 'Channel', value: channelTarget(entry) },
							{ name: 'Type', value: String((entry.target as any)?.type ?? 'Unknown') },
							{ name: 'Created By', value: executor(entry) },
						],
						timestamp: true,
					}),
					chId,
				);
			}

			case AuditLogEvent.ChannelDelete: {
				const chId = (entry.target as any)?.id as string | undefined;
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'Channel Deleted',
						color: Colors.Error,
						fields: [
							{ name: 'Channel', value: channelTarget(entry) },
							{ name: 'Deleted By', value: executor(entry) },
						],
						timestamp: true,
					}),
					chId,
				);
			}

			case AuditLogEvent.ChannelUpdate: {
				const chId = (entry.target as any)?.id as string | undefined;
				const changes = entry.changes ?? [];
				const fieldList = changes
					.filter((c) => ['name', 'topic', 'nsfw', 'rate_limit_per_user'].includes(c.key))
					.map((c) => ({ name: `${c.key} changed`, value: `${c.old ?? '*(none)*'} → ${c.new ?? '*(none)*'}` }));
				if (fieldList.length === 0) return null;
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'Channel Updated',
						color: Colors.Neutral,
						fields: [
							{ name: 'Channel', value: channelTarget(entry) },
							{ name: 'Updated By', value: executor(entry) },
							...fieldList,
						],
						timestamp: true,
					}),
					chId,
				);
			}

			// ── Channel permission overwrite actions ─────────────────────────────────

			case AuditLogEvent.ChannelOverwriteCreate:
			case AuditLogEvent.ChannelOverwriteUpdate:
			case AuditLogEvent.ChannelOverwriteDelete: {
				const extra = entry.extra as { id: string; type: number; roleName?: string } | null;
				const isRole = extra?.type === 0;
				const overwriteTarget = extra?.id
					? isRole
						? `${roleMention(extra.id)}${extra.roleName ? ` (${extra.roleName})` : ''}`
						: userMention(extra.id)
					: 'Unknown';

				const formatPerms = (bits: unknown): string => {
					if (bits == null || bits === '0' || bits === 0) return '*(none)*';
					try {
						const bf = new PermissionsBitField(BigInt(String(bits)));
						const names = bf.toArray();
						return names.length ? names.map((n) => `\`${n}\``).join(', ') : '*(none)*';
					} catch {
						return `\`${bits}\``;
					}
				};

				const overwriteChanges = entry.changes ?? [];
				const allow = overwriteChanges.find((c) => c.key === 'allow');
				const deny = overwriteChanges.find((c) => c.key === 'deny');

				const actionLabel =
					entry.action === AuditLogEvent.ChannelOverwriteCreate
						? 'Added'
						: entry.action === AuditLogEvent.ChannelOverwriteDelete
							? 'Removed'
							: 'Updated';

				const overwriteFields: Array<{ name: string; value: string }> = [
					{ name: 'Channel', value: channelTarget(entry) },
					{ name: `${isRole ? 'Role' : 'User'} Override`, value: overwriteTarget },
					{ name: 'Updated By', value: executor(entry) },
				];
				if (allow) {
					const o = formatPerms(allow.old);
					const n = formatPerms(allow.new);
					if (o !== n) overwriteFields.push({ name: 'Allow Changed', value: `${o} → ${n}` });
				}
				if (deny) {
					const o = formatPerms(deny.old);
					const n = formatPerms(deny.new);
					if (o !== n) overwriteFields.push({ name: 'Deny Changed', value: `${o} → ${n}` });
				}

				return sendLog(
					guild,
					logContainer({
						entry,
						title: `Channel Permissions ${actionLabel}`,
						color:
							entry.action === AuditLogEvent.ChannelOverwriteCreate
								? Colors.Success
								: entry.action === AuditLogEvent.ChannelOverwriteDelete
									? Colors.Error
									: Colors.Neutral,
						fields: overwriteFields,
						timestamp: true,
					}),
					(entry.target as any)?.id as string | undefined,
				);
			}

			// ── Role actions ─────────────────────────────────────────────────────────

			case AuditLogEvent.RoleCreate:
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'Role Created',
						color: Colors.Success,
						fields: [
							{ name: 'Role', value: roleTarget(entry) },
							{ name: 'Created By', value: executor(entry) },
						],
						timestamp: true,
					}),
				);

			case AuditLogEvent.RoleDelete:
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'Role Deleted',
						color: Colors.Error,
						fields: [
							{ name: 'Role', value: roleTarget(entry) },
							{ name: 'Deleted By', value: executor(entry) },
						],
						timestamp: true,
					}),
				);

			case AuditLogEvent.RoleUpdate: {
				const changes = entry.changes ?? [];
				const interesting = changes.filter((c) =>
					['name', 'color', 'hoist', 'mentionable', 'permissions'].includes(c.key),
				);
				if (interesting.length === 0) return null;
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'Role Updated',
						color: Colors.Neutral,
						fields: [
							{ name: 'Role', value: roleTarget(entry) },
							{ name: 'Updated By', value: executor(entry) },
							...interesting.map((c) => {
								if (c.key === 'permissions') {
									try {
										const o = new PermissionsBitField(BigInt(String(c.old ?? 0))).toArray();
										const n = new PermissionsBitField(BigInt(String(c.new ?? 0))).toArray();
										const added = n.filter((p) => !o.includes(p));
										const removed = o.filter((p) => !n.includes(p));
										const parts: string[] = [];
										if (added.length) parts.push(`+${added.map((p) => `\`${p}\``).join(', ')}`);
										if (removed.length) parts.push(`−${removed.map((p) => `\`${p}\``).join(', ')}`);
										return { name: 'Permissions', value: parts.join('\n') || '*(no change)*' };
									} catch {
										return { name: 'Permissions', value: '*(see audit log)*' };
									}
								}
								return { name: `${c.key}`, value: `${c.old ?? '*(none)*'} → ${c.new ?? '*(none)*'}` };
							}),
						],
						timestamp: true,
					}),
				);
			}

			// ── Invite actions ───────────────────────────────────────────────────────

			case AuditLogEvent.InviteCreate:
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'Invite Created',
						color: Colors.Info,
						fields: [
							{ name: 'Code', value: `\`${(entry.target as any)?.code ?? 'unknown'}\`` },
							{
								name: 'Channel',
								value: (entry.target as any)?.channelId ? channelMention((entry.target as any).channelId) : 'Unknown',
							},
							{ name: 'Created By', value: executor(entry) },
							{ name: 'Max Uses', value: String((entry.target as any)?.maxUses ?? '∞') },
							{
								name: 'Expires',
								value: (entry.target as any)?.expiresAt
									? `<t:${Math.floor(new Date((entry.target as any).expiresAt).getTime() / 1000)}:R>`
									: 'Never',
							},
						],
						timestamp: true,
					}),
					(entry.target as any)?.channelId as string | undefined,
				);

			case AuditLogEvent.InviteDelete:
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'Invite Deleted',
						color: Colors.Warning,
						fields: [
							{ name: 'Code', value: `\`${(entry.target as any)?.code ?? 'unknown'}\`` },
							{ name: 'Deleted By', value: executor(entry) },
						],
						timestamp: true,
					}),
				);

			case AuditLogEvent.InviteUpdate:
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'Invite Updated',
						color: Colors.Neutral,
						fields: [
							{ name: 'Code', value: `\`${(entry.target as any)?.code ?? 'unknown'}\`` },
							{ name: 'Updated By', value: executor(entry) },
						],
						timestamp: true,
					}),
				);

			// ── Webhook actions ──────────────────────────────────────────────────────

			case AuditLogEvent.WebhookCreate:
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'Webhook Created',
						color: Colors.Info,
						fields: [
							{ name: 'Webhook', value: target(entry) },
							{ name: 'Created By', value: executor(entry) },
						],
						timestamp: true,
					}),
				);

			case AuditLogEvent.WebhookDelete:
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'Webhook Deleted',
						color: Colors.Error,
						fields: [
							{ name: 'Webhook', value: target(entry) },
							{ name: 'Deleted By', value: executor(entry) },
						],
						timestamp: true,
					}),
				);

			case AuditLogEvent.WebhookUpdate:
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'Webhook Updated',
						color: Colors.Neutral,
						fields: [
							{ name: 'Webhook', value: target(entry) },
							{ name: 'Updated By', value: executor(entry) },
						],
						timestamp: true,
					}),
				);

			// ── Emoji actions ────────────────────────────────────────────────────────

			case AuditLogEvent.EmojiCreate: {
				const emojiT = entry.target as any;
				const emojiId = emojiT?.id as string | null;
				const emojiName = (emojiT?.name as string | null) ?? 'unknown';
				const animated = emojiT?.animated === true;
				const emojiStr = emojiId
					? animated
						? `<a:${emojiName}:${emojiId}>`
						: `<:${emojiName}:${emojiId}>`
					: emojiName;
				const emojiUrl = emojiId
					? `https://cdn.discordapp.com/emojis/${emojiId}.${animated ? 'gif' : 'webp'}?size=128`
					: undefined;
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'Emoji Created',
						color: Colors.Success,
						fields: [
							{ name: 'Emoji', value: `${emojiStr} (\`${emojiName}\`${emojiId ? ` • \`${emojiId}\`` : ''})` },
							{ name: 'Created By', value: executor(entry) },
						],
						thumbnailUrl: emojiUrl,
						timestamp: true,
					}),
				);
			}

			case AuditLogEvent.EmojiDelete:
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'Emoji Deleted',
						color: Colors.Error,
						fields: [
							{ name: 'Emoji', value: target(entry) },
							{ name: 'Deleted By', value: executor(entry) },
						],
						timestamp: true,
					}),
				);

			case AuditLogEvent.EmojiUpdate:
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'Emoji Updated',
						color: Colors.Neutral,
						fields: [
							{ name: 'Emoji', value: target(entry) },
							{ name: 'Updated By', value: executor(entry) },
						],
						timestamp: true,
					}),
				);

			// ── Sticker actions ──────────────────────────────────────────────────────

			case AuditLogEvent.StickerCreate:
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'Sticker Created',
						color: Colors.Success,
						fields: [
							{ name: 'Sticker', value: target(entry) },
							{ name: 'Created By', value: executor(entry) },
						],
						timestamp: true,
					}),
				);

			case AuditLogEvent.StickerDelete:
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'Sticker Deleted',
						color: Colors.Error,
						fields: [
							{ name: 'Sticker', value: target(entry) },
							{ name: 'Deleted By', value: executor(entry) },
						],
						timestamp: true,
					}),
				);

			case AuditLogEvent.StickerUpdate:
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'Sticker Updated',
						color: Colors.Neutral,
						fields: [
							{ name: 'Sticker', value: target(entry) },
							{ name: 'Updated By', value: executor(entry) },
						],
						timestamp: true,
					}),
				);

			// ── Thread actions ───────────────────────────────────────────────────────

			case AuditLogEvent.ThreadCreate:
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'Thread Created',
						color: Colors.Info,
						fields: [
							{ name: 'Thread', value: target(entry) },
							{ name: 'Created By', value: executor(entry) },
						],
						timestamp: true,
					}),
					(entry.target as any)?.id as string | undefined,
				);

			case AuditLogEvent.ThreadDelete:
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'Thread Deleted',
						color: Colors.Error,
						fields: [
							{ name: 'Thread', value: target(entry) },
							{ name: 'Deleted By', value: executor(entry) },
						],
						timestamp: true,
					}),
					(entry.target as any)?.id as string | undefined,
				);

			case AuditLogEvent.ThreadUpdate:
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'Thread Updated',
						color: Colors.Neutral,
						fields: [
							{ name: 'Thread', value: target(entry) },
							{ name: 'Updated By', value: executor(entry) },
						],
						timestamp: true,
					}),
					(entry.target as any)?.id as string | undefined,
				);

			// ── Stage instance actions ────────────────────────────────────────────────

			case AuditLogEvent.StageInstanceCreate:
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'Stage Started',
						color: Colors.Info,
						fields: [
							{ name: 'Topic', value: (entry.target as any)?.topic ?? 'Unknown' },
							{ name: 'Started By', value: executor(entry) },
						],
						timestamp: true,
					}),
				);

			case AuditLogEvent.StageInstanceDelete:
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'Stage Ended',
						color: Colors.Neutral,
						fields: [
							{ name: 'Topic', value: (entry.target as any)?.topic ?? 'Unknown' },
							{ name: 'Ended By', value: executor(entry) },
						],
						timestamp: true,
					}),
				);

			case AuditLogEvent.StageInstanceUpdate:
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'Stage Updated',
						color: Colors.Neutral,
						fields: [{ name: 'Updated By', value: executor(entry) }],
						timestamp: true,
					}),
				);

			// ── Scheduled event actions ───────────────────────────────────────────────

			case AuditLogEvent.GuildScheduledEventCreate:
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'Scheduled Event Created',
						color: Colors.Info,
						fields: [
							{ name: 'Event', value: (entry.target as any)?.name ?? 'Unknown' },
							{ name: 'Created By', value: executor(entry) },
						],
						timestamp: true,
					}),
				);

			case AuditLogEvent.GuildScheduledEventDelete:
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'Scheduled Event Deleted',
						color: Colors.Error,
						fields: [
							{ name: 'Event', value: (entry.target as any)?.name ?? 'Unknown' },
							{ name: 'Deleted By', value: executor(entry) },
						],
						timestamp: true,
					}),
				);

			case AuditLogEvent.GuildScheduledEventUpdate:
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'Scheduled Event Updated',
						color: Colors.Neutral,
						fields: [
							{ name: 'Event', value: (entry.target as any)?.name ?? 'Unknown' },
							{ name: 'Updated By', value: executor(entry) },
						],
						timestamp: true,
					}),
				);

			// ── AutoMod actions ───────────────────────────────────────────────────────

			case AuditLogEvent.AutoModerationRuleCreate:
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'AutoMod Rule Created',
						color: Colors.Info,
						fields: [
							{ name: 'Rule', value: target(entry) },
							{ name: 'Created By', value: executor(entry) },
						],
						timestamp: true,
					}),
				);

			case AuditLogEvent.AutoModerationRuleDelete:
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'AutoMod Rule Deleted',
						color: Colors.Error,
						fields: [
							{ name: 'Rule', value: target(entry) },
							{ name: 'Deleted By', value: executor(entry) },
						],
						timestamp: true,
					}),
				);

			case AuditLogEvent.AutoModerationRuleUpdate:
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'AutoMod Rule Updated',
						color: Colors.Neutral,
						fields: [
							{ name: 'Rule', value: target(entry) },
							{ name: 'Updated By', value: executor(entry) },
						],
						timestamp: true,
					}),
				);

			case AuditLogEvent.AutoModerationBlockMessage:
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'AutoMod Blocked Message',
						color: Colors.Warning,
						fields: [
							{ name: 'User', value: userTarget(entry) },
							{ name: 'Rule', value: entry.extra ? `\`${(entry.extra as any).autoModerationRuleName}\`` : 'Unknown' },
						],
						timestamp: true,
					}),
				);

			case AuditLogEvent.AutoModerationFlagToChannel:
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'AutoMod Flagged Message',
						color: Colors.Warning,
						fields: [
							{ name: 'User', value: userTarget(entry) },
							{ name: 'Rule', value: entry.extra ? `\`${(entry.extra as any).autoModerationRuleName}\`` : 'Unknown' },
						],
						timestamp: true,
					}),
				);

			case AuditLogEvent.AutoModerationUserCommunicationDisabled:
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'AutoMod Timed Out User',
						color: Colors.Warning,
						fields: [
							{ name: 'User', value: userTarget(entry) },
							{ name: 'Rule', value: entry.extra ? `\`${(entry.extra as any).autoModerationRuleName}\`` : 'Unknown' },
						],
						timestamp: true,
					}),
				);

			// ── Guild update ──────────────────────────────────────────────────────────

			case AuditLogEvent.GuildUpdate: {
				const changes = entry.changes ?? [];
				const interestingKeys = [
					'name',
					'icon',
					'splash',
					'verification_level',
					'default_message_notifications',
					'explicit_content_filter',
					'afk_channel_id',
					'system_channel_id',
				];
				const interesting = changes.filter((c) => interestingKeys.includes(c.key));
				const rawChanges = changes as Array<{ key: string; old: unknown; new: unknown }>;
				const featuresChange = rawChanges.find((c) => c.key === 'features');

				if (interesting.length === 0 && !featuresChange) return null;

				const guildFields: Array<{ name: string; value: string }> = [{ name: 'Updated By', value: executor(entry) }];

				if (featuresChange) {
					const oldF = (featuresChange.old as string[] | null) ?? [];
					const newF = (featuresChange.new as string[] | null) ?? [];
					const added = newF.filter((f) => !oldF.includes(f));
					const removed = oldF.filter((f) => !newF.includes(f));
					if (added.length > 0)
						guildFields.push({ name: 'Features Added', value: added.map((f) => `\`${f}\``).join(', ') });
					if (removed.length > 0)
						guildFields.push({ name: 'Features Removed', value: removed.map((f) => `\`${f}\``).join(', ') });
				}

				guildFields.push(
					...interesting.map((c) => ({ name: c.key, value: `${c.old ?? '*(none)*'} → ${c.new ?? '*(none)*'}` })),
				);

				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'Server Settings Updated',
						color: Colors.Neutral,
						fields: guildFields,
						timestamp: true,
					}),
				);
			}

			// ── Message actions ───────────────────────────────────────────────────────

			case AuditLogEvent.MessageDelete:
				return sendModLog(
					guild,
					logContainer({
						entry,
						title: 'Message Deleted',
						color: Colors.Message,
						fields: [
							{ name: 'User', value: userTarget(entry) },
							{
								name: 'Channel',
								value: entry.extra ? channelMention((entry.extra as any).channel?.id ?? '0') : 'Unknown',
							},
							{ name: 'Count', value: String((entry.extra as any)?.count ?? 1) },
							{ name: 'Deleted By', value: executor(entry) },
						],
						timestamp: true,
					}),
				);

			case AuditLogEvent.MessageBulkDelete:
				return sendModLog(
					guild,
					logContainer({
						entry,
						title: 'Messages Bulk Deleted',
						color: Colors.Message,
						fields: [
							{ name: 'Channel', value: channelTarget(entry) },
							{ name: 'Count', value: String((entry.extra as any)?.count ?? '?') },
							{ name: 'Deleted By', value: executor(entry) },
						],
						timestamp: true,
					}),
				);

			case AuditLogEvent.MessagePin:
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'Message Pinned',
						color: Colors.Info,
						fields: [
							{
								name: 'Channel',
								value: entry.extra ? channelMention((entry.extra as any).channel?.id ?? '0') : 'Unknown',
							},
							{ name: 'Pinned By', value: executor(entry) },
						],
						timestamp: true,
					}),
					(entry.extra as any)?.channel?.id as string | undefined,
				);

			case AuditLogEvent.MessageUnpin:
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'Message Unpinned',
						color: Colors.Neutral,
						fields: [
							{
								name: 'Channel',
								value: entry.extra ? channelMention((entry.extra as any).channel?.id ?? '0') : 'Unknown',
							},
							{ name: 'Unpinned By', value: executor(entry) },
						],
						timestamp: true,
					}),
					(entry.extra as any)?.channel?.id as string | undefined,
				);

			// ── Voice actions ─────────────────────────────────────────────────────────

			case AuditLogEvent.MemberMove:
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'Voice Member Moved',
						color: Colors.Voice,
						fields: [
							{ name: 'Moved By', value: executor(entry) },
							{
								name: 'Channel',
								value: entry.extra ? channelMention((entry.extra as any).channel?.id ?? '0') : 'Unknown',
							},
							{ name: 'Count', value: String((entry.extra as any)?.count ?? '?') },
						],
						timestamp: true,
					}),
					(entry.extra as any)?.channel?.id as string | undefined,
				);

			case AuditLogEvent.MemberDisconnect:
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'Voice Member Disconnected',
						color: Colors.Voice,
						fields: [
							{ name: 'Disconnected By', value: executor(entry) },
							{ name: 'Count', value: String((entry.extra as any)?.count ?? '?') },
						],
						timestamp: true,
					}),
				);

			// ── Integration actions ───────────────────────────────────────────────────

			case AuditLogEvent.IntegrationCreate:
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'Integration Added',
						color: Colors.Info,
						fields: [
							{ name: 'Integration', value: target(entry) },
							{ name: 'Added By', value: executor(entry) },
						],
						timestamp: true,
					}),
				);

			case AuditLogEvent.IntegrationDelete:
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'Integration Removed',
						color: Colors.Error,
						fields: [
							{ name: 'Integration', value: target(entry) },
							{ name: 'Removed By', value: executor(entry) },
						],
						timestamp: true,
					}),
				);

			case AuditLogEvent.IntegrationUpdate:
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'Integration Updated',
						color: Colors.Neutral,
						fields: [
							{ name: 'Integration', value: target(entry) },
							{ name: 'Updated By', value: executor(entry) },
						],
						timestamp: true,
					}),
				);

			// ── Application command permissions ───────────────────────────────────────

			case AuditLogEvent.ApplicationCommandPermissionUpdate:
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'Command Permissions Updated',
						color: Colors.Neutral,
						fields: [
							{ name: 'Updated By', value: executor(entry) },
							{
								name: 'Command',
								value: (entry.extra as any)?.applicationId
									? `\`${(entry.target as any)?.name ?? (entry.extra as any).applicationId}\``
									: '*(unknown)*',
							},
						],
						timestamp: true,
					}),
				);

			// ── Soundboard actions ────────────────────────────────────────────────────

			case AuditLogEvent.SoundboardSoundCreate:
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'Soundboard Sound Added',
						color: Colors.Success,
						fields: [
							{ name: 'Sound', value: target(entry) },
							{ name: 'Added By', value: executor(entry) },
						],
						timestamp: true,
					}),
				);

			case AuditLogEvent.SoundboardSoundDelete:
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'Soundboard Sound Deleted',
						color: Colors.Error,
						fields: [
							{ name: 'Sound', value: target(entry) },
							{ name: 'Deleted By', value: executor(entry) },
						],
						timestamp: true,
					}),
				);

			case AuditLogEvent.SoundboardSoundUpdate:
				return sendLog(
					guild,
					logContainer({
						entry,
						title: 'Soundboard Sound Updated',
						color: Colors.Neutral,
						fields: [
							{ name: 'Sound', value: target(entry) },
							{ name: 'Updated By', value: executor(entry) },
						],
						timestamp: true,
					}),
				);

			default:
				return null;
		}
	}
}
