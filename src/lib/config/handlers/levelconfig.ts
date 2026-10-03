import type { Subcommand } from '@sapphire/plugin-subcommands';
import { MessageFlags, TextDisplayBuilder } from 'discord.js';
import { and, eq, sql } from 'drizzle-orm';
import {
	Colors,
	CV2_FLAG,
	errorReply,
	hint,
	makeContainer,
	spacer,
	successReply,
	warningReply,
} from '../../../lib/components.js';
import { db, schema } from '../../../lib/database.js';
import {
	BOOST_MAX_DURATION_MS,
	countLevelMultipliers,
	getActiveBoost,
	getOrCreateLevelSettings,
	listLevelMultipliers,
	MAX_XP_MULTIPLIER,
	removeLevelMultiplier,
	setLevelMultiplier,
	upsertLevelSettings,
} from '../../../lib/LevelingUtil.js';
import { DURATION_HINT, humanDuration, parseDuration } from '../../../lib/parseDuration.js';
import { safeJsonParse } from '../../../lib/safe.js';

const SERVER_ONLY = 'This command can only be used in a server.';

/** Components V2 messages hold at most 4000 characters of text; leave room for the header and footer. */
const LIST_TEXT_BUDGET = 3200;

/** `150` -> `150% (1.5x)`. */
function formatPercent(percent: number): string {
	return `${percent}% (${Number((percent / 100).toFixed(2))}x)`;
}

/** Joins lines until the budget is used up, then notes how many were left out. */
function joinWithinBudget(lines: string[], budget: number): string {
	const kept: string[] = [];
	let used = 0;
	for (const line of lines) {
		if (used + line.length + 1 > budget) break;
		kept.push(line);
		used += line.length + 1;
	}
	if (kept.length < lines.length) kept.push(`-# …and ${lines.length - kept.length} more`);
	return kept.join('\n');
}

function unixSeconds(ms: number): number {
	return Math.floor(ms / 1000);
}

export class LevelConfigHandler {
	// ─── Enable / Disable ─────────────────────────────────────────────────────

	public async chatInputEnable(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply(SERVER_ONLY));
		await upsertLevelSettings(interaction.guildId, { enabled: true });
		return interaction.editReply(successReply('Leveling is now **enabled**.'));
	}

	public async chatInputDisable(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply(SERVER_ONLY));
		await upsertLevelSettings(interaction.guildId, { enabled: false });
		return interaction.editReply(successReply('Leveling is now **disabled**.'));
	}

	// ─── XP Rate ──────────────────────────────────────────────────────────────

	public async chatInputXpRate(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply(SERVER_ONLY));
		const min = interaction.options.getInteger('min', true);
		const max = interaction.options.getInteger('max', true);
		const cooldown = interaction.options.getInteger('cooldown', true);
		if (min > max) {
			return interaction.editReply(errorReply('Min XP must be less than or equal to max XP.'));
		}
		await upsertLevelSettings(interaction.guildId, { xpMin: min, xpMax: max, cooldownSeconds: cooldown });
		return interaction.editReply(
			successReply(`XP rate set to **${min}–${max}** per message with a **${cooldown}s** cooldown.`),
		);
	}

	// ─── Level-up channel ────────────────────────────────────────────────────

	public async chatInputLevelupChannel(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply(SERVER_ONLY));
		const channel = interaction.options.getChannel('channel');
		await upsertLevelSettings(interaction.guildId, { levelUpChannelId: channel?.id ?? null });
		return interaction.editReply(
			successReply(
				channel
					? `Level-up messages will be sent to <#${channel.id}>.`
					: 'Level-up messages will be sent in the same channel as the triggering message.',
			),
		);
	}

	// ─── Level-up message ────────────────────────────────────────────────────

	public async chatInputLevelupMessage(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply(SERVER_ONLY));
		const message = interaction.options.getString('message', true);
		await upsertLevelSettings(interaction.guildId, { levelUpMessage: message });
		return interaction.editReply(successReply(`Level-up message updated.`));
	}

	// ─── No-XP roles ─────────────────────────────────────────────────────────

	public async chatInputNoXpRoleAdd(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply(SERVER_ONLY));
		const role = interaction.options.getRole('role', true);
		const settings = await getOrCreateLevelSettings(interaction.guildId);
		const list = safeJsonParse<string[]>(settings.noXpRoleIds, []);
		if (list.includes(role.id)) {
			return interaction.editReply(errorReply(`<@&${role.id}> is already in the no-XP list.`));
		}
		list.push(role.id);
		await upsertLevelSettings(interaction.guildId, { noXpRoleIds: JSON.stringify(list) });
		return interaction.editReply(successReply(`<@&${role.id}> will no longer earn XP.`));
	}

	public async chatInputNoXpRoleRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply(SERVER_ONLY));
		const role = interaction.options.getRole('role', true);
		const settings = await getOrCreateLevelSettings(interaction.guildId);
		const list = safeJsonParse<string[]>(settings.noXpRoleIds, []);
		const next = list.filter((id) => id !== role.id);
		if (next.length === list.length) {
			return interaction.editReply(errorReply(`<@&${role.id}> was not in the no-XP list.`));
		}
		await upsertLevelSettings(interaction.guildId, { noXpRoleIds: JSON.stringify(next) });
		return interaction.editReply(successReply(`<@&${role.id}> will now earn XP again.`));
	}

	// ─── No-XP channels ──────────────────────────────────────────────────────

	public async chatInputNoXpChannelAdd(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply(SERVER_ONLY));
		const channel = interaction.options.getChannel('channel', true);
		const settings = await getOrCreateLevelSettings(interaction.guildId);
		const list = safeJsonParse<string[]>(settings.noXpChannelIds, []);
		if (list.includes(channel.id)) {
			return interaction.editReply(errorReply(`<#${channel.id}> is already in the no-XP list.`));
		}
		list.push(channel.id);
		await upsertLevelSettings(interaction.guildId, { noXpChannelIds: JSON.stringify(list) });
		return interaction.editReply(successReply(`XP will no longer be earned in <#${channel.id}>.`));
	}

	public async chatInputNoXpChannelRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply(SERVER_ONLY));
		const channel = interaction.options.getChannel('channel', true);
		const settings = await getOrCreateLevelSettings(interaction.guildId);
		const list = safeJsonParse<string[]>(settings.noXpChannelIds, []);
		const next = list.filter((id) => id !== channel.id);
		if (next.length === list.length) {
			return interaction.editReply(errorReply(`<#${channel.id}> was not in the no-XP list.`));
		}
		await upsertLevelSettings(interaction.guildId, { noXpChannelIds: JSON.stringify(next) });
		return interaction.editReply(successReply(`XP will be earned in <#${channel.id}> again.`));
	}

	// ─── Role Rewards ─────────────────────────────────────────────────────────

	public async chatInputRoleRewardAdd(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply(SERVER_ONLY));
		const level = interaction.options.getInteger('level', true);
		const role = interaction.options.getRole('role', true);
		await db
			.insert(schema.levelRoles)
			.values({ guildId: interaction.guildId, level, roleId: role.id })
			.onDuplicateKeyUpdate({ set: { id: sql`${schema.levelRoles.id}` } });
		return interaction.editReply(
			successReply(`<@&${role.id}> will be assigned when members reach **level ${level}**.`),
		);
	}

	public async chatInputRoleRewardRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply(SERVER_ONLY));
		const level = interaction.options.getInteger('level', true);
		const role = interaction.options.getRole('role', true);
		const existing = await db
			.select({ id: schema.levelRoles.id })
			.from(schema.levelRoles)
			.where(
				and(
					eq(schema.levelRoles.guildId, interaction.guildId),
					eq(schema.levelRoles.level, level),
					eq(schema.levelRoles.roleId, role.id),
				),
			)
			.limit(1)
			.then((r) => r[0] ?? null);
		if (!existing) {
			return interaction.editReply(errorReply(`No role reward found for level ${level} / <@&${role.id}>.`));
		}
		await db
			.delete(schema.levelRoles)
			.where(
				and(
					eq(schema.levelRoles.guildId, interaction.guildId),
					eq(schema.levelRoles.level, level),
					eq(schema.levelRoles.roleId, role.id),
				),
			);
		return interaction.editReply(successReply(`Role reward removed.`));
	}

	public async chatInputRoleRewardList(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply(SERVER_ONLY));
		const rewards = await db
			.select()
			.from(schema.levelRoles)
			.where(eq(schema.levelRoles.guildId, interaction.guildId))
			.orderBy(schema.levelRoles.level);

		if (rewards.length === 0) {
			return interaction.editReply(
				errorReply('No role rewards configured. Use `/leveling role-reward-add` to add one.'),
			);
		}

		const lines = rewards.map((r) => `**Level ${r.level}** → <@&${r.roleId}>`).join('\n');

		const container = makeContainer({ color: Colors.Info, header: 'Level Role Rewards' });
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines));
		return interaction.editReply({ components: [container], flags: CV2_FLAG });
	}

	// ─── Voice XP ─────────────────────────────────────────────────────────────

	public async chatInputVoiceXp(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply(SERVER_ONLY));
		const enabled = interaction.options.getBoolean('enabled', true);
		const xpPerMinute = interaction.options.getInteger('xp-per-minute') ?? undefined;
		const minMembers = interaction.options.getInteger('min-members') ?? undefined;
		const update: Parameters<typeof upsertLevelSettings>[1] = { voiceXpEnabled: enabled };
		if (xpPerMinute !== undefined) update.voiceXpPerMinute = xpPerMinute;
		if (minMembers !== undefined) update.voiceMinMembers = minMembers;
		await upsertLevelSettings(interaction.guildId, update);
		const parts = [`Voice XP: **${enabled ? 'Enabled' : 'Disabled'}**`];
		if (xpPerMinute !== undefined) parts.push(`Rate: **${xpPerMinute} XP/min**`);
		if (minMembers !== undefined) parts.push(`Min members in VC: **${minMembers}**`);
		return interaction.editReply(successReply(parts.join(' • ')));
	}

	public async chatInputNoXpVoiceAdd(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply(SERVER_ONLY));
		const channel = interaction.options.getChannel('channel', true);
		const settings = await getOrCreateLevelSettings(interaction.guildId);
		const list = safeJsonParse<string[]>(settings.noXpVoiceChannelIds, []);
		if (list.includes(channel.id)) {
			return interaction.editReply(errorReply(`<#${channel.id}> is already in the no-XP voice list.`));
		}
		list.push(channel.id);
		await upsertLevelSettings(interaction.guildId, { noXpVoiceChannelIds: JSON.stringify(list) });
		return interaction.editReply(successReply(`XP will not be earned in <#${channel.id}>.`));
	}

	public async chatInputNoXpVoiceRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply(SERVER_ONLY));
		const channel = interaction.options.getChannel('channel', true);
		const settings = await getOrCreateLevelSettings(interaction.guildId);
		const list = safeJsonParse<string[]>(settings.noXpVoiceChannelIds, []);
		const next = list.filter((id) => id !== channel.id);
		if (next.length === list.length) {
			return interaction.editReply(errorReply(`<#${channel.id}> was not in the no-XP voice list.`));
		}
		await upsertLevelSettings(interaction.guildId, { noXpVoiceChannelIds: JSON.stringify(next) });
		return interaction.editReply(successReply(`XP will be earned in <#${channel.id}> again.`));
	}

	// ─── XP multipliers ───────────────────────────────────────────────────────

	public async chatInputMultiplierSetRole(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply(SERVER_ONLY));
		const role = interaction.options.getRole('role', true);
		const percent = interaction.options.getInteger('percent', true);
		await setLevelMultiplier(interaction.guildId, 'role', role.id, percent);
		return interaction.editReply(
			successReply(
				`Members with <@&${role.id}> now earn **${formatPercent(percent)}** XP. ` +
					`When a member has several multiplier roles, the highest applies. Combined multipliers are capped at ${MAX_XP_MULTIPLIER}x.`,
			),
		);
	}

	public async chatInputMultiplierSetChannel(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply(SERVER_ONLY));
		const channel = interaction.options.getChannel('channel', true);
		const percent = interaction.options.getInteger('percent', true);
		await setLevelMultiplier(interaction.guildId, 'channel', channel.id, percent);
		return interaction.editReply(
			successReply(
				`XP earned in <#${channel.id}> (and its threads) is now **${formatPercent(percent)}**. ` +
					`Combined multipliers are capped at ${MAX_XP_MULTIPLIER}x.`,
			),
		);
	}

	public async chatInputMultiplierRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply(SERVER_ONLY));
		const role = interaction.options.getRole('role');
		const channel = interaction.options.getChannel('channel');
		if (!role && !channel) {
			return interaction.editReply(errorReply('Choose a role, a channel, or both to remove a multiplier from.'));
		}

		const removed: string[] = [];
		const missing: string[] = [];
		if (role) {
			const ok = await removeLevelMultiplier(interaction.guildId, 'role', role.id);
			(ok ? removed : missing).push(`<@&${role.id}>`);
		}
		if (channel) {
			const ok = await removeLevelMultiplier(interaction.guildId, 'channel', channel.id);
			(ok ? removed : missing).push(`<#${channel.id}>`);
		}

		if (removed.length === 0) {
			return interaction.editReply(errorReply(`No multiplier was set for ${missing.join(' or ')}.`));
		}
		const note = missing.length > 0 ? ` ${missing.join(', ')} had no multiplier.` : '';
		return interaction.editReply(successReply(`Multiplier removed for ${removed.join(', ')}.${note}`));
	}

	public async chatInputMultiplierList(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply(SERVER_ONLY));
		const [rows, settings] = await Promise.all([
			listLevelMultipliers(interaction.guildId),
			getOrCreateLevelSettings(interaction.guildId),
		]);
		const boost = getActiveBoost(settings);

		if (rows.length === 0 && !boost) {
			return interaction.editReply(
				warningReply('No XP multipliers or boosts are set. Use `/leveling multiplier set-role` or `set-channel`.'),
			);
		}

		const roleLines = rows
			.filter((r) => r.targetType === 'role')
			.map((r) => `<@&${r.targetId}> · ${formatPercent(r.percent)}`);
		const channelLines = rows
			.filter((r) => r.targetType === 'channel')
			.map((r) => `<#${r.targetId}> · ${formatPercent(r.percent)}`);

		const sections: string[] = [];
		if (boost) {
			sections.push(`**Active boost** ${formatPercent(boost.percent)} · ends <t:${unixSeconds(boost.endsAt)}:R>`);
		}
		// Share the text budget between the two lists so a long one cannot hide the other.
		const roleBudget = channelLines.length > 0 ? Math.floor(LIST_TEXT_BUDGET / 2) : LIST_TEXT_BUDGET;
		if (roleLines.length > 0) sections.push(`**Roles**\n${joinWithinBudget(roleLines, roleBudget)}`);
		if (channelLines.length > 0) {
			sections.push(
				`**Channels**\n${joinWithinBudget(channelLines, roleLines.length > 0 ? LIST_TEXT_BUDGET - roleBudget : LIST_TEXT_BUDGET)}`,
			);
		}

		const container = makeContainer({ color: Colors.Info, header: 'XP Multipliers' });
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(sections.join('\n\n')));
		container.addSeparatorComponents(spacer());
		container.addTextDisplayComponents(
			hint(`Highest role × channel × boost, capped at ${MAX_XP_MULTIPLIER}x. 150% = 1.5x XP.`),
		);
		return interaction.editReply({ components: [container], flags: CV2_FLAG });
	}

	// ─── XP boost ─────────────────────────────────────────────────────────────

	public async chatInputBoostStart(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply(SERVER_ONLY));
		const percent = interaction.options.getInteger('percent', true);
		const durationMs = parseDuration(interaction.options.getString('duration', true));
		if (durationMs === null) {
			return interaction.editReply(errorReply(`I couldn't read that duration. ${DURATION_HINT}`));
		}
		if (durationMs > BOOST_MAX_DURATION_MS) {
			return interaction.editReply(
				errorReply(`A boost can last at most **${humanDuration(BOOST_MAX_DURATION_MS)}**. Choose a shorter duration.`),
			);
		}

		const settings = await getOrCreateLevelSettings(interaction.guildId);
		const replaced = getActiveBoost(settings) !== null;
		const endsAt = Date.now() + durationMs;
		await upsertLevelSettings(interaction.guildId, { boostPercent: percent, boostEndsAt: endsAt });
		return interaction.editReply(
			successReply(
				`XP boost started\n**${formatPercent(percent)}** for **${humanDuration(durationMs)}**, ending <t:${unixSeconds(endsAt)}:R>.` +
					(replaced ? '\n-# Replaces the boost that was running.' : '') +
					`\n-# Combined multipliers are capped at ${MAX_XP_MULTIPLIER}x.`,
			),
		);
	}

	public async chatInputBoostStop(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply(SERVER_ONLY));
		const settings = await getOrCreateLevelSettings(interaction.guildId);
		if (!getActiveBoost(settings)) return interaction.editReply(errorReply('There is no active XP boost.'));
		await upsertLevelSettings(interaction.guildId, { boostPercent: 100, boostEndsAt: null });
		return interaction.editReply(successReply('XP boost stopped.'));
	}

	// ─── View ─────────────────────────────────────────────────────────────────

	public async chatInputView(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply(SERVER_ONLY));
		const s = await getOrCreateLevelSettings(interaction.guildId);

		const noXpRoles = safeJsonParse<string[]>(s.noXpRoleIds, []);
		const noXpChannels = safeJsonParse<string[]>(s.noXpChannelIds, []);
		const noXpVoice = safeJsonParse<string[]>(s.noXpVoiceChannelIds, []);
		const multiplierCount = await countLevelMultipliers(interaction.guildId);
		const boost = getActiveBoost(s);

		const lines = [
			`**Status** ${s.enabled ? 'Enabled' : 'Disabled'}`,
			`**XP Rate** ${s.xpMin}–${s.xpMax} per message · **Cooldown** ${s.cooldownSeconds}s`,
			`**Level-up channel** ${s.levelUpChannelId ? `<#${s.levelUpChannelId}>` : 'Same channel as message'}`,
			`**Level-up message** \`${s.levelUpMessage}\``,
			`**No-XP roles** ${noXpRoles.length ? noXpRoles.map((id) => `<@&${id}>`).join(', ') : 'None'}`,
			`**No-XP channels** ${noXpChannels.length ? noXpChannels.map((id) => `<#${id}>`).join(', ') : 'None'}`,
			``,
			`**Voice XP** ${s.voiceXpEnabled ? 'Enabled' : 'Disabled'} · **Rate** ${s.voiceXpPerMinute} XP/min · **Min members** ${s.voiceMinMembers}`,
			`**No-XP voice channels** ${noXpVoice.length ? noXpVoice.map((id) => `<#${id}>`).join(', ') : 'None'}`,
			``,
			`**XP multipliers** ${multiplierCount} configured · \`/leveling multiplier list\``,
			`**XP boost** ${boost ? `${formatPercent(boost.percent)}, ends <t:${unixSeconds(boost.endsAt)}:R>` : 'None'}`,
		].join('\n');

		const container = makeContainer({ color: Colors.Info, header: 'Leveling Configuration' });
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines));
		container.addSeparatorComponents(spacer());
		container.addTextDisplayComponents(hint('Use `/leveling role-reward-list` for role reward details.'));
		return interaction.editReply({ components: [container], flags: CV2_FLAG });
	}
}
