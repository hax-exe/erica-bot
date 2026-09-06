import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { MessageFlags, PermissionFlagsBits, TextDisplayBuilder } from 'discord.js';
import { and, eq } from 'drizzle-orm';
import {
	AUTOMOD_ACTION_LABELS,
	AUTOMOD_ACTIONS,
	AUTOMOD_RULE_LABELS,
	AUTOMOD_RULES,
	type AutomodAction,
	type AutomodRule,
	getOrCreateAutomodSettings,
} from '../../lib/AutomodUtil.js';
import { Colors, CV2_FLAG, errorReply, makeContainer, successReply, warningReply } from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';

const RULE_CHOICES = AUTOMOD_RULES.map((r) => ({ name: AUTOMOD_RULE_LABELS[r], value: r }));
const ACTION_CHOICES = AUTOMOD_ACTIONS.map((a) => ({ name: AUTOMOD_ACTION_LABELS[a], value: a }));

function ruleFields(rule: AutomodRule): {
	enabled: keyof typeof schema.automodSettings.$inferSelect;
	action: keyof typeof schema.automodSettings.$inferSelect;
	timeoutKey: keyof typeof schema.automodSettings.$inferSelect;
} {
	const map: Record<AutomodRule, ReturnType<typeof ruleFields>> = {
		'word-filter': { enabled: 'wordFilterEnabled', action: 'wordFilterAction', timeoutKey: 'wordFilterTimeoutMinutes' },
		spam: { enabled: 'spamEnabled', action: 'spamAction', timeoutKey: 'spamTimeoutMinutes' },
		caps: { enabled: 'capsEnabled', action: 'capsAction', timeoutKey: 'capsTimeoutMinutes' },
		links: { enabled: 'linkEnabled', action: 'linkAction', timeoutKey: 'linkTimeoutMinutes' },
		invites: { enabled: 'inviteEnabled', action: 'inviteAction', timeoutKey: 'inviteTimeoutMinutes' },
		mentions: { enabled: 'mentionEnabled', action: 'mentionAction', timeoutKey: 'mentionTimeoutMinutes' },
		'new-account': {
			enabled: 'newAccountEnabled',
			action: 'newAccountAction',
			timeoutKey: 'newAccountTimeoutMinutes',
		},
	};
	return map[rule];
}

@ApplyOptions<Subcommand.Options>({
	name: 'automod',
	description: 'Configure the AutoMod system for this server.',
	preconditions: ['Moderation'],
	subcommands: [
		{ name: 'status', chatInputRun: 'chatInputStatus' },
		{ name: 'toggle', chatInputRun: 'chatInputToggle' },
		{ name: 'configure', chatInputRun: 'chatInputConfigure' },
		{ name: 'whitelist-add', chatInputRun: 'chatInputWhitelistAdd' },
		{ name: 'whitelist-remove', chatInputRun: 'chatInputWhitelistRemove' },
		{ name: 'whitelist-list', chatInputRun: 'chatInputWhitelistList' },
		{ name: 'word-add', chatInputRun: 'chatInputWordAdd' },
		{ name: 'word-remove', chatInputRun: 'chatInputWordRemove' },
		{ name: 'word-list', chatInputRun: 'chatInputWordList' },
		{ name: 'exempt-role-add', chatInputRun: 'chatInputExemptRoleAdd' },
		{ name: 'exempt-role-remove', chatInputRun: 'chatInputExemptRoleRemove' },
		{ name: 'exempt-channel-add', chatInputRun: 'chatInputExemptChannelAdd' },
		{ name: 'exempt-channel-remove', chatInputRun: 'chatInputExemptChannelRemove' },
	],
})
export class AutomodCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('automod')
				.setDescription('Configure the AutoMod system for this server.')
				.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
				.addSubcommand((sub) => sub.setName('status').setDescription('Show the current AutoMod configuration.'))
				.addSubcommand((sub) =>
					sub
						.setName('toggle')
						.setDescription('Enable or disable an AutoMod rule.')
						.addStringOption((o) =>
							o
								.setName('rule')
								.setDescription('Which rule.')
								.setRequired(true)
								.addChoices(...RULE_CHOICES),
						)
						.addBooleanOption((o) => o.setName('enabled').setDescription('Enable or disable.').setRequired(true)),
				)
				.addSubcommand((sub) =>
					sub
						.setName('configure')
						.setDescription('Set thresholds, actions, and timeouts for a rule.')
						.addStringOption((o) =>
							o
								.setName('rule')
								.setDescription('Which rule to configure.')
								.setRequired(true)
								.addChoices(...RULE_CHOICES),
						)
						.addStringOption((o) =>
							o
								.setName('action')
								.setDescription('What to do when the rule triggers.')
								.setRequired(false)
								.addChoices(...ACTION_CHOICES),
						)
						.addIntegerOption((o) =>
							o
								.setName('timeout-minutes')
								.setDescription('Minutes to timeout the user (for delete_timeout action).')
								.setMinValue(1)
								.setMaxValue(40320)
								.setRequired(false),
						)
						.addIntegerOption((o) =>
							o
								.setName('threshold')
								.setDescription(
									'Threshold: spam=max msgs, caps=% uppercase, mentions=max @mentions, new-account=min age days.',
								)
								.setMinValue(1)
								.setMaxValue(1000)
								.setRequired(false),
						)
						.addIntegerOption((o) =>
							o
								.setName('window')
								.setDescription('Spam: time window in seconds.')
								.setMinValue(1)
								.setMaxValue(60)
								.setRequired(false),
						)
						.addIntegerOption((o) =>
							o
								.setName('min-length')
								.setDescription('Caps: minimum message character count before checking.')
								.setMinValue(1)
								.setMaxValue(500)
								.setRequired(false),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('whitelist-add')
						.setDescription('Allow a domain in the link filter (e.g. youtube.com).')
						.addStringOption((o) =>
							o.setName('domain').setDescription('Domain to allow (e.g. youtube.com).').setRequired(true),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('whitelist-remove')
						.setDescription('Remove a domain from the link whitelist.')
						.addStringOption((o) => o.setName('domain').setDescription('Domain to remove.').setRequired(true)),
				)
				.addSubcommand((sub) => sub.setName('whitelist-list').setDescription('List all whitelisted link domains.'))
				.addSubcommand((sub) =>
					sub
						.setName('word-add')
						.setDescription('Add a word or phrase to the filter.')
						.addStringOption((o) =>
							o.setName('word').setDescription('Word, phrase, or regex pattern.').setRequired(true),
						)
						.addBooleanOption((o) => o.setName('regex').setDescription('Treat as a regex pattern.').setRequired(false)),
				)
				.addSubcommand((sub) =>
					sub
						.setName('word-remove')
						.setDescription('Remove a word or phrase from the filter.')
						.addStringOption((o) => o.setName('word').setDescription('Word or phrase to remove.').setRequired(true)),
				)
				.addSubcommand((sub) => sub.setName('word-list').setDescription('List all filtered words and phrases.'))
				.addSubcommand((sub) =>
					sub
						.setName('exempt-role-add')
						.setDescription('Exempt a role from AutoMod.')
						.addRoleOption((o) => o.setName('role').setDescription('Role to exempt.').setRequired(true)),
				)
				.addSubcommand((sub) =>
					sub
						.setName('exempt-role-remove')
						.setDescription('Remove a role exemption.')
						.addRoleOption((o) => o.setName('role').setDescription('Role to un-exempt.').setRequired(true)),
				)
				.addSubcommand((sub) =>
					sub
						.setName('exempt-channel-add')
						.setDescription('Exempt a channel from AutoMod.')
						.addChannelOption((o) => o.setName('channel').setDescription('Channel to exempt.').setRequired(true)),
				)
				.addSubcommand((sub) =>
					sub
						.setName('exempt-channel-remove')
						.setDescription('Remove a channel exemption.')
						.addChannelOption((o) => o.setName('channel').setDescription('Channel to un-exempt.').setRequired(true)),
				),
		);
	}

	public async chatInputStatus(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server-only command.'));

		const s = await getOrCreateAutomodSettings(interaction.guildId);
		const exemptRoles = JSON.parse(s.exemptRoles) as string[];
		const exemptChannels = JSON.parse(s.exemptChannels) as string[];
		const whitelist = JSON.parse(s.linkWhitelist) as string[];

		const line = (enabled: boolean, label: string, detail: string) =>
			`${enabled ? '🟢' : '🔴'} **${label}**${detail ? `\n-# ${detail}` : ''}`;

		const lines = [
			line(
				s.wordFilterEnabled,
				'Word Filter',
				`Action: ${AUTOMOD_ACTION_LABELS[s.wordFilterAction as AutomodAction]}${s.wordFilterAction !== 'delete' ? ` · ${s.wordFilterTimeoutMinutes}m` : ''}`,
			),
			line(
				s.spamEnabled,
				'Spam Detection',
				`Max ${s.spamMaxMessages} msgs in ${s.spamWindowSeconds}s · Action: ${AUTOMOD_ACTION_LABELS[s.spamAction as AutomodAction]}${s.spamAction !== 'delete' ? ` · ${s.spamTimeoutMinutes}m` : ''}`,
			),
			line(
				s.capsEnabled,
				'Caps Filter',
				`≥${s.capsPercent}% caps, min ${s.capsMinLength} chars · Action: ${AUTOMOD_ACTION_LABELS[s.capsAction as AutomodAction]}`,
			),
			line(
				s.linkEnabled,
				'Link Filter',
				`Action: ${AUTOMOD_ACTION_LABELS[s.linkAction as AutomodAction]} · Whitelist: ${whitelist.length ? whitelist.join(', ') : 'none'}`,
			),
			line(s.inviteEnabled, 'Invite Filter', `Action: ${AUTOMOD_ACTION_LABELS[s.inviteAction as AutomodAction]}`),
			line(
				s.mentionEnabled,
				'Mass Mention Filter',
				`Max ${s.mentionMax} unique mentions · Action: ${AUTOMOD_ACTION_LABELS[s.mentionAction as AutomodAction]}`,
			),
			line(
				s.newAccountEnabled,
				'New Account Filter',
				`Min account age: ${s.newAccountAgeDays}d · Action: ${AUTOMOD_ACTION_LABELS[s.newAccountAction as AutomodAction]}`,
			),
		];

		const container = makeContainer({ color: Colors.Info, header: 'AutoMod Configuration' });
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n\n')));

		if (exemptRoles.length || exemptChannels.length) {
			container.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					[
						exemptRoles.length ? `**Exempt roles:** ${exemptRoles.map((r) => `<@&${r}>`).join(', ')}` : null,
						exemptChannels.length ? `**Exempt channels:** ${exemptChannels.map((c) => `<#${c}>`).join(', ')}` : null,
					]
						.filter(Boolean)
						.join('\n'),
				),
			);
		}

		return interaction.editReply({ components: [container], flags: CV2_FLAG });
	}

	public async chatInputToggle(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server-only command.'));

		const rule = interaction.options.getString('rule', true) as AutomodRule;
		const enabled = interaction.options.getBoolean('enabled', true);
		const { enabled: enabledKey } = ruleFields(rule);

		await db
			.insert(schema.automodSettings)
			.values({ guildId: interaction.guildId, [enabledKey]: enabled })
			.onDuplicateKeyUpdate({
				set: { [enabledKey]: enabled },
			});

		return interaction.editReply(
			successReply(`**${AUTOMOD_RULE_LABELS[rule]}** ${enabled ? 'enabled 🟢' : 'disabled 🔴'}.`),
		);
	}

	public async chatInputConfigure(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server-only command.'));

		const rule = interaction.options.getString('rule', true) as AutomodRule;
		const action = interaction.options.getString('action') as AutomodAction | null;
		const timeoutMinutes = interaction.options.getInteger('timeout-minutes');
		const threshold = interaction.options.getInteger('threshold');
		const window = interaction.options.getInteger('window');
		const minLength = interaction.options.getInteger('min-length');

		if (!action && timeoutMinutes === null && threshold === null && window === null && minLength === null) {
			return interaction.editReply(errorReply('Provide at least one setting to change.'));
		}

		const { action: actionKey, timeoutKey } = ruleFields(rule);
		const patch: Record<string, unknown> = {};
		if (action) patch[actionKey] = action;
		if (timeoutMinutes !== null) patch[timeoutKey] = timeoutMinutes;

		if (threshold !== null) {
			if (rule === 'spam') patch.spamMaxMessages = threshold;
			else if (rule === 'caps') patch.capsPercent = threshold;
			else if (rule === 'mentions') patch.mentionMax = threshold;
			else if (rule === 'new-account') patch.newAccountAgeDays = threshold;
		}
		if (window !== null && rule === 'spam') patch.spamWindowSeconds = window;
		if (minLength !== null && rule === 'caps') patch.capsMinLength = minLength;

		await db
			.insert(schema.automodSettings)
			.values({ guildId: interaction.guildId, ...patch })
			.onDuplicateKeyUpdate({ set: patch });

		const changed = Object.keys(patch)
			.map((k) => `\`${k}\``)
			.join(', ');
		return interaction.editReply(successReply(`**${AUTOMOD_RULE_LABELS[rule]}** updated (${changed}).`));
	}

	public async chatInputWhitelistAdd(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server-only command.'));

		const domain = interaction.options
			.getString('domain', true)
			.toLowerCase()
			.replace(/^https?:\/\//, '');
		const s = await getOrCreateAutomodSettings(interaction.guildId);
		const list = JSON.parse(s.linkWhitelist) as string[];
		if (list.includes(domain)) return interaction.editReply(warningReply(`\`${domain}\` is already whitelisted.`));
		list.push(domain);
		await db
			.update(schema.automodSettings)
			.set({ linkWhitelist: JSON.stringify(list) })
			.where(eq(schema.automodSettings.guildId, interaction.guildId));
		return interaction.editReply(successReply(`\`${domain}\` added to the link whitelist.`));
	}

	public async chatInputWhitelistRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server-only command.'));

		const domain = interaction.options
			.getString('domain', true)
			.toLowerCase()
			.replace(/^https?:\/\//, '');
		const s = await getOrCreateAutomodSettings(interaction.guildId);
		const list = JSON.parse(s.linkWhitelist) as string[];
		const filtered = list.filter((d) => d !== domain);
		if (filtered.length === list.length)
			return interaction.editReply(warningReply(`\`${domain}\` is not in the whitelist.`));
		await db
			.update(schema.automodSettings)
			.set({ linkWhitelist: JSON.stringify(filtered) })
			.where(eq(schema.automodSettings.guildId, interaction.guildId));
		return interaction.editReply(successReply(`\`${domain}\` removed from the link whitelist.`));
	}

	public async chatInputWhitelistList(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server-only command.'));

		const s = await getOrCreateAutomodSettings(interaction.guildId);
		const list = JSON.parse(s.linkWhitelist) as string[];
		if (list.length === 0) return interaction.editReply(warningReply('No domains are whitelisted yet.'));
		return interaction.editReply(`**Link whitelist (${list.length}):**\n${list.map((d) => `• \`${d}\``).join('\n')}`);
	}

	public async chatInputWordAdd(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server-only command.'));

		const word = interaction.options.getString('word', true).toLowerCase();
		const isRegex = interaction.options.getBoolean('regex') ?? false;

		if (isRegex) {
			try {
				new RegExp(word);
			} catch {
				return interaction.editReply(errorReply('Invalid regex pattern.'));
			}
		}

		const existing = await db
			.select({ id: schema.automodWordFilter.id })
			.from(schema.automodWordFilter)
			.where(and(eq(schema.automodWordFilter.guildId, interaction.guildId), eq(schema.automodWordFilter.word, word)))
			.limit(1)
			.then((r) => r[0] ?? null);

		if (existing) return interaction.editReply(warningReply(`\`${word}\` is already in the filter.`));

		await db.insert(schema.automodWordFilter).values({ guildId: interaction.guildId, word, isRegex });
		return interaction.editReply(successReply(`\`${word}\` added to the word filter${isRegex ? ' (regex)' : ''}.`));
	}

	public async chatInputWordRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server-only command.'));

		const word = interaction.options.getString('word', true).toLowerCase();
		const result = await db
			.delete(schema.automodWordFilter)
			.where(and(eq(schema.automodWordFilter.guildId, interaction.guildId), eq(schema.automodWordFilter.word, word)));
		const affected = Number((result as any)[0]?.affectedRows ?? 0);

		if (affected === 0) return interaction.editReply(warningReply(`\`${word}\` is not in the filter.`));
		return interaction.editReply(successReply(`\`${word}\` removed from the word filter.`));
	}

	public async chatInputWordList(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server-only command.'));

		const words = await db
			.select()
			.from(schema.automodWordFilter)
			.where(eq(schema.automodWordFilter.guildId, interaction.guildId))
			.orderBy(schema.automodWordFilter.word);

		if (words.length === 0) return interaction.editReply(warningReply('No words in the filter yet.'));
		const lines = words.map((w) => `• \`${w.word}\`${w.isRegex ? ' *(regex)*' : ''}`);
		return interaction.editReply(`**Word filter (${words.length}):**\n${lines.join('\n')}`);
	}

	public async chatInputExemptRoleAdd(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server-only command.'));

		const role = interaction.options.getRole('role', true);
		const s = await getOrCreateAutomodSettings(interaction.guildId);
		const list = JSON.parse(s.exemptRoles) as string[];
		if (list.includes(role.id)) return interaction.editReply(warningReply(`<@&${role.id}> is already exempt.`));
		list.push(role.id);
		await db
			.update(schema.automodSettings)
			.set({ exemptRoles: JSON.stringify(list) })
			.where(eq(schema.automodSettings.guildId, interaction.guildId));
		return interaction.editReply(successReply(`<@&${role.id}> is now exempt from AutoMod.`));
	}

	public async chatInputExemptRoleRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server-only command.'));

		const role = interaction.options.getRole('role', true);
		const s = await getOrCreateAutomodSettings(interaction.guildId);
		const list = JSON.parse(s.exemptRoles) as string[];
		const filtered = list.filter((r) => r !== role.id);
		if (filtered.length === list.length) return interaction.editReply(warningReply(`<@&${role.id}> is not exempt.`));
		await db
			.update(schema.automodSettings)
			.set({ exemptRoles: JSON.stringify(filtered) })
			.where(eq(schema.automodSettings.guildId, interaction.guildId));
		return interaction.editReply(successReply(`<@&${role.id}> exemption removed.`));
	}

	public async chatInputExemptChannelAdd(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server-only command.'));

		const channel = interaction.options.getChannel('channel', true);
		const s = await getOrCreateAutomodSettings(interaction.guildId);
		const list = JSON.parse(s.exemptChannels) as string[];
		if (list.includes(channel.id)) return interaction.editReply(warningReply(`<#${channel.id}> is already exempt.`));
		list.push(channel.id);
		await db
			.update(schema.automodSettings)
			.set({ exemptChannels: JSON.stringify(list) })
			.where(eq(schema.automodSettings.guildId, interaction.guildId));
		return interaction.editReply(successReply(`<#${channel.id}> is now exempt from AutoMod.`));
	}

	public async chatInputExemptChannelRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server-only command.'));

		const channel = interaction.options.getChannel('channel', true);
		const s = await getOrCreateAutomodSettings(interaction.guildId);
		const list = JSON.parse(s.exemptChannels) as string[];
		const filtered = list.filter((c) => c !== channel.id);
		if (filtered.length === list.length) return interaction.editReply(warningReply(`<#${channel.id}> is not exempt.`));
		await db
			.update(schema.automodSettings)
			.set({ exemptChannels: JSON.stringify(filtered) })
			.where(eq(schema.automodSettings.guildId, interaction.guildId));
		return interaction.editReply(successReply(`<#${channel.id}> exemption removed.`));
	}
}
