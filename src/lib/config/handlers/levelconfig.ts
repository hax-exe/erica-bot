import type { Subcommand } from '@sapphire/plugin-subcommands';
import { MessageFlags, SeparatorBuilder, TextDisplayBuilder } from 'discord.js';
import { and, eq, sql } from 'drizzle-orm';
import { Colors, CV2_FLAG, errorReply, makeContainer, successReply } from '../../../lib/components.js';
import { db, schema } from '../../../lib/database.js';
import { getOrCreateLevelSettings, upsertLevelSettings } from '../../../lib/LevelingUtil.js';

export class LevelConfigHandler {
	// ─── Enable / Disable ─────────────────────────────────────────────────────

	public async chatInputEnable(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return;
		await upsertLevelSettings(interaction.guildId, { enabled: true });
		return interaction.editReply(successReply('Leveling is now **enabled**.'));
	}

	public async chatInputDisable(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return;
		await upsertLevelSettings(interaction.guildId, { enabled: false });
		return interaction.editReply(successReply('Leveling is now **disabled**.'));
	}

	// ─── XP Rate ──────────────────────────────────────────────────────────────

	public async chatInputXpRate(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return;
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
		if (!interaction.inCachedGuild()) return;
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
		if (!interaction.inCachedGuild()) return;
		const message = interaction.options.getString('message', true);
		await upsertLevelSettings(interaction.guildId, { levelUpMessage: message });
		return interaction.editReply(successReply(`Level-up message updated.`));
	}

	// ─── No-XP roles ─────────────────────────────────────────────────────────

	public async chatInputNoXpRoleAdd(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return;
		const role = interaction.options.getRole('role', true);
		const settings = await getOrCreateLevelSettings(interaction.guildId);
		const list: string[] = JSON.parse(settings.noXpRoleIds);
		if (list.includes(role.id)) {
			return interaction.editReply(errorReply(`<@&${role.id}> is already in the no-XP list.`));
		}
		list.push(role.id);
		await upsertLevelSettings(interaction.guildId, { noXpRoleIds: JSON.stringify(list) });
		return interaction.editReply(successReply(`<@&${role.id}> will no longer earn XP.`));
	}

	public async chatInputNoXpRoleRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return;
		const role = interaction.options.getRole('role', true);
		const settings = await getOrCreateLevelSettings(interaction.guildId);
		const list: string[] = JSON.parse(settings.noXpRoleIds);
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
		if (!interaction.inCachedGuild()) return;
		const channel = interaction.options.getChannel('channel', true);
		const settings = await getOrCreateLevelSettings(interaction.guildId);
		const list: string[] = JSON.parse(settings.noXpChannelIds);
		if (list.includes(channel.id)) {
			return interaction.editReply(errorReply(`<#${channel.id}> is already in the no-XP list.`));
		}
		list.push(channel.id);
		await upsertLevelSettings(interaction.guildId, { noXpChannelIds: JSON.stringify(list) });
		return interaction.editReply(successReply(`XP will no longer be earned in <#${channel.id}>.`));
	}

	public async chatInputNoXpChannelRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return;
		const channel = interaction.options.getChannel('channel', true);
		const settings = await getOrCreateLevelSettings(interaction.guildId);
		const list: string[] = JSON.parse(settings.noXpChannelIds);
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
		if (!interaction.inCachedGuild()) return;
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
		if (!interaction.inCachedGuild()) return;
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
		if (!interaction.inCachedGuild()) return;
		const rewards = await db
			.select()
			.from(schema.levelRoles)
			.where(eq(schema.levelRoles.guildId, interaction.guildId))
			.orderBy(schema.levelRoles.level);

		if (rewards.length === 0) {
			return interaction.editReply(
				errorReply('No role rewards configured. Use `/levelconfig role-reward-add` to add one.'),
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
		if (!interaction.inCachedGuild()) return;
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
		if (!interaction.inCachedGuild()) return;
		const channel = interaction.options.getChannel('channel', true);
		const settings = await getOrCreateLevelSettings(interaction.guildId);
		const list: string[] = JSON.parse(settings.noXpVoiceChannelIds);
		if (list.includes(channel.id)) {
			return interaction.editReply(errorReply(`<#${channel.id}> is already in the no-XP voice list.`));
		}
		list.push(channel.id);
		await upsertLevelSettings(interaction.guildId, { noXpVoiceChannelIds: JSON.stringify(list) });
		return interaction.editReply(successReply(`XP will not be earned in <#${channel.id}>.`));
	}

	public async chatInputNoXpVoiceRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return;
		const channel = interaction.options.getChannel('channel', true);
		const settings = await getOrCreateLevelSettings(interaction.guildId);
		const list: string[] = JSON.parse(settings.noXpVoiceChannelIds);
		const next = list.filter((id) => id !== channel.id);
		if (next.length === list.length) {
			return interaction.editReply(errorReply(`<#${channel.id}> was not in the no-XP voice list.`));
		}
		await upsertLevelSettings(interaction.guildId, { noXpVoiceChannelIds: JSON.stringify(next) });
		return interaction.editReply(successReply(`XP will be earned in <#${channel.id}> again.`));
	}

	// ─── View ─────────────────────────────────────────────────────────────────

	public async chatInputView(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return;
		const s = await getOrCreateLevelSettings(interaction.guildId);

		const noXpRoles: string[] = JSON.parse(s.noXpRoleIds);
		const noXpChannels: string[] = JSON.parse(s.noXpChannelIds);
		const noXpVoice: string[] = JSON.parse(s.noXpVoiceChannelIds);

		const lines = [
			`**Status** ${s.enabled ? 'Enabled' : 'Disabled'}`,
			`**XP Rate** ${s.xpMin}–${s.xpMax} per message • **Cooldown** ${s.cooldownSeconds}s`,
			`**Level-up channel** ${s.levelUpChannelId ? `<#${s.levelUpChannelId}>` : 'Same channel as message'}`,
			`**Level-up message** \`${s.levelUpMessage}\``,
			`**No-XP roles** ${noXpRoles.length ? noXpRoles.map((id) => `<@&${id}>`).join(', ') : 'None'}`,
			`**No-XP channels** ${noXpChannels.length ? noXpChannels.map((id) => `<#${id}>`).join(', ') : 'None'}`,
			``,
			`**Voice XP** ${s.voiceXpEnabled ? 'Enabled' : 'Disabled'} • **Rate** ${s.voiceXpPerMinute} XP/min • **Min members** ${s.voiceMinMembers}`,
			`**No-XP voice channels** ${noXpVoice.length ? noXpVoice.map((id) => `<#${id}>`).join(', ') : 'None'}`,
		].join('\n');

		const container = makeContainer({ color: Colors.Info, header: 'Leveling Configuration' });
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines));
		container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				'-# Use `/admin badge list` and `/levelconfig role-reward-list` for badge and reward details.',
			),
		);
		return interaction.editReply({ components: [container], flags: CV2_FLAG });
	}
}
