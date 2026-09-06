import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { ChannelType, MessageFlags, PermissionFlagsBits, type TextChannel, WebhookClient } from 'discord.js';
import { eq } from 'drizzle-orm';
import { errorReply, successReply, warningReply } from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';
import { getOrCreateModules, MODULE_LABELS, MODULES, setModule } from '../../lib/ModuleUtil.js';

/** Silently deletes a webhook by its URL. Ignores errors (e.g. already deleted). */
async function tryDeleteWebhook(url: string): Promise<void> {
	const match = url.match(/webhooks\/(\d+)\/([^/?]+)/);
	if (!match) return;
	const [, id, token] = match;
	const wh = new WebhookClient({ id, token });
	try {
		await wh.delete('Log channel changed via /config');
	} catch {
		// Already deleted or missing — ignore
	} finally {
		wh.destroy();
	}
}

@ApplyOptions<Subcommand.Options>({
	name: 'config',
	description: 'Configure bot settings for this server.',
	preconditions: ['Moderation'],
	subcommands: [
		{
			name: 'log',
			type: 'group',
			entries: [
				{ name: 'channel', chatInputRun: 'chatInputLogChannel' },
				{ name: 'ignore-add', chatInputRun: 'chatInputLogIgnoreAdd' },
				{ name: 'ignore-remove', chatInputRun: 'chatInputLogIgnoreRemove' },
				{ name: 'ignore-list', chatInputRun: 'chatInputLogIgnoreList' },
			],
		},
		{
			name: 'tts',
			type: 'group',
			entries: [
				{ name: 'role', chatInputRun: 'chatInputSetTtsRole' },
				{ name: 'conflict', chatInputRun: 'chatInputTtsConflict' },
				{ name: 'language', chatInputRun: 'chatInputTtsLanguage' },
			],
		},
		{ name: 'modules', chatInputRun: 'chatInputModules' },
		{
			name: 'suggestions',
			type: 'group',
			entries: [
				{ name: 'setup-channel', chatInputRun: 'chatInputSuggestionsSetupChannel' },
				{ name: 'setup-dm', chatInputRun: 'chatInputSuggestionsSetupDm' },
				{ name: 'approve', chatInputRun: 'chatInputSuggestionsApprove' },
				{ name: 'deny', chatInputRun: 'chatInputSuggestionsDeny' },
				{ name: 'implement', chatInputRun: 'chatInputSuggestionsImplement' },
			],
		},
	],
})
export class ConfigCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) => {
			builder
				.setName('config')
				.setDescription('Configure bot settings for this server.')
				.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
				// ── log ───────────────────────────────────────────────────────────────
				.addSubcommandGroup((group) =>
					group
						.setName('log')
						.setDescription('Configure server logs and exclusions.')
						.addSubcommand((sub) =>
							sub
								.setName('channel')
								.setDescription('Set or clear a log channel.')
								.addStringOption((o) =>
									o
										.setName('type')
										.setDescription('The log category.')
										.setRequired(true)
										.addChoices(
											{ name: 'General Logs', value: 'general' },
											{ name: 'Moderation Logs', value: 'moderation' },
											{ name: 'Member Reports', value: 'reports' },
										),
								)
								.addChannelOption((o) =>
									o
										.setName('channel')
										.setDescription('Text channel to post logs in (omit to clear).')
										.addChannelTypes(ChannelType.GuildText)
										.setRequired(false),
								),
						)
						.addSubcommand((sub) =>
							sub
								.setName('ignore-add')
								.setDescription('Exclude a channel from general logs.')
								.addChannelOption((o) => o.setName('channel').setDescription('Channel to ignore.').setRequired(true)),
						)
						.addSubcommand((sub) =>
							sub
								.setName('ignore-remove')
								.setDescription('Re-enable general logs for a previously ignored channel.')
								.addChannelOption((o) =>
									o.setName('channel').setDescription('Channel to un-ignore.').setRequired(true),
								),
						)
						.addSubcommand((sub) =>
							sub.setName('ignore-list').setDescription('List all channels currently excluded from general logs.'),
						),
				)
				// ── tts ────────────────────────────────────────────────────────────────
				.addSubcommandGroup((group) =>
					group
						.setName('tts')
						.setDescription('Configure Text-to-Speech settings.')
						.addSubcommand((sub) =>
							sub
								.setName('role')
								.setDescription('Set or clear the role that is allowed to use TTS.')
								.addRoleOption((o) =>
									o
										.setName('role')
										.setDescription('Role required for TTS (omit to clear / allow only Admins).')
										.setRequired(false),
								),
						)
						.addSubcommand((sub) =>
							sub
								.setName('conflict')
								.setDescription('Configure how TTS behaves when music is playing.')
								.addStringOption((o) =>
									o
										.setName('mode')
										.setDescription('Conflict behavior.')
										.setRequired(true)
										.addChoices(
											{ name: 'Block TTS (Default)', value: 'block' },
											{ name: 'Interrupt Music', value: 'interrupt' },
										),
								),
						)
						.addSubcommand((sub) =>
							sub
								.setName('language')
								.setDescription('Configure the default language code for TTS.')
								.addStringOption((o) =>
									o
										.setName('language')
										.setDescription('Language code (default: en).')
										.setRequired(true)
										.addChoices(
											{ name: 'English (US)', value: 'en' },
											{ name: 'Spanish', value: 'es' },
											{ name: 'French', value: 'fr' },
											{ name: 'German', value: 'de' },
											{ name: 'Japanese', value: 'ja' },
											{ name: 'Chinese', value: 'zh' },
											{ name: 'Portuguese', value: 'pt' },
											{ name: 'Italian', value: 'it' },
											{ name: 'Russian', value: 'ru' },
											{ name: 'Korean', value: 'ko' },
										),
								),
						),
				)
				// ── modules ───────────────────────────────────────────────────────────
				.addSubcommand((sub) =>
					sub
						.setName('modules')
						.setDescription('View or toggle bot modules for this server.')
						.addStringOption((o) =>
							o
								.setName('module')
								.setDescription('Module to toggle (omit to view all).')
								.setRequired(false)
								.addChoices(...MODULES.map((m) => ({ name: MODULE_LABELS[m], value: m }))),
						)
						.addBooleanOption((o) =>
							o.setName('enabled').setDescription('Enable or disable the module.').setRequired(false),
						),
				)
				// ── suggestions ────────────────────────────────────────────────────────
				.addSubcommandGroup((group) =>
					group
						.setName('suggestions')
						.setDescription('Manage the suggestion system.')
						.addSubcommand((sub) =>
							sub
								.setName('setup-channel')
								.setDescription('Set the channel where suggestions are posted.')
								.addChannelOption((o) =>
									o
										.setName('channel')
										.setDescription('The suggestion channel.')
										.addChannelTypes(ChannelType.GuildText)
										.setRequired(true),
								),
						)
						.addSubcommand((sub) =>
							sub
								.setName('setup-dm')
								.setDescription('Toggle DMs to users when their suggestion is reviewed.')
								.addBooleanOption((o) =>
									o.setName('enabled').setDescription('Enable DM notifications?').setRequired(true),
								),
						)
						.addSubcommand((sub) =>
							sub
								.setName('approve')
								.setDescription('Approve a suggestion.')
								.addIntegerOption((o) =>
									o.setName('id').setDescription('The suggestion ID.').setRequired(true).setMinValue(1),
								)
								.addStringOption((o) =>
									o.setName('reason').setDescription('Optional reason.').setRequired(false).setMaxLength(500),
								),
						)
						.addSubcommand((sub) =>
							sub
								.setName('deny')
								.setDescription('Deny a suggestion.')
								.addIntegerOption((o) =>
									o.setName('id').setDescription('The suggestion ID.').setRequired(true).setMinValue(1),
								)
								.addStringOption((o) =>
									o.setName('reason').setDescription('Optional reason.').setRequired(false).setMaxLength(500),
								),
						)
						.addSubcommand((sub) =>
							sub
								.setName('implement')
								.setDescription('Mark a suggestion as implemented.')
								.addIntegerOption((o) =>
									o.setName('id').setDescription('The suggestion ID.').setRequired(true).setMinValue(1),
								)
								.addStringOption((o) =>
									o.setName('reason').setDescription('Optional note.').setRequired(false).setMaxLength(500),
								),
						),
				);
		});
	}

	private async upsert(guildId: string, patch: Partial<typeof schema.guilds.$inferInsert>) {
		await db
			.insert(schema.guilds)
			.values({ id: guildId, ...patch })
			.onDuplicateKeyUpdate({
				set: patch,
			});
	}

	private async setLogChannel(
		interaction: Subcommand.ChatInputCommandInteraction,
		urlField: 'logWebhookUrl' | 'modLogWebhookUrl' | 'ticketLogWebhookUrl' | 'reportWebhookUrl',
		label: string,
	) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}

		const channel = interaction.options.getChannel('channel') as TextChannel | null;
		const [row] = await db.select().from(schema.guilds).where(eq(schema.guilds.id, interaction.guildId)).limit(1);

		const existingUrl: string | null = (row?.[urlField] as string | null | undefined) ?? null;
		if (existingUrl) {
			await tryDeleteWebhook(existingUrl);
		}

		if (!channel) {
			await this.upsert(interaction.guildId, { [urlField]: null });
			return interaction.editReply(successReply(`${label} log channel cleared.`));
		}

		let webhookUrl: string;
		try {
			const avatarUrl = interaction.client.user.displayAvatarURL({ extension: 'png', size: 256 });
			const webhookName = {
				logWebhookUrl: 'Erica — Logs',
				modLogWebhookUrl: 'Erica — Moderation Logs',
				ticketLogWebhookUrl: 'Erica — Ticket Logs',
				reportWebhookUrl: 'Erica — Report Logs',
			}[urlField];
			const wh = await channel.createWebhook({
				name: webhookName,
				avatar: avatarUrl,
				reason: `Set by ${interaction.user.tag} via /config`,
			});
			webhookUrl = wh.url;
		} catch {
			return interaction.editReply(
				errorReply(
					`Failed to create a webhook in <#${channel.id}>. Make sure I have the **Manage Webhooks** permission in that channel.`,
				),
			);
		}

		await this.upsert(interaction.guildId, { [urlField]: webhookUrl });
		return interaction.editReply(successReply(`${label} logs will be posted in <#${channel.id}>.`));
	}

	// ── /config log channel ───────────────────────────────────────────────────────
	public async chatInputLogChannel(interaction: Subcommand.ChatInputCommandInteraction) {
		const type = interaction.options.getString('type', true);
		if (type === 'general') {
			return this.chatInputSetLogChannel(interaction);
		} else if (type === 'moderation') {
			return this.chatInputSetModLogChannel(interaction);
		} else if (type === 'reports') {
			return this.chatInputSetReportChannel(interaction);
		}
		return interaction.reply({ content: 'Invalid log type.', flags: MessageFlags.Ephemeral });
	}

	// ── /config setlogchannel ─────────────────────────────────────────────────────
	public async chatInputSetLogChannel(interaction: Subcommand.ChatInputCommandInteraction) {
		return this.setLogChannel(interaction, 'logWebhookUrl', 'General');
	}

	// ── /config setmodlogchannel ──────────────────────────────────────────────────
	public async chatInputSetModLogChannel(interaction: Subcommand.ChatInputCommandInteraction) {
		return this.setLogChannel(interaction, 'modLogWebhookUrl', 'Mod-log');
	}

	// ── /config setreportchannel ──────────────────────────────────────────────────
	public async chatInputSetReportChannel(interaction: Subcommand.ChatInputCommandInteraction) {
		return this.setLogChannel(interaction, 'reportWebhookUrl', 'Report');
	}

	// ── /config modules ───────────────────────────────────────────────────────────
	public async chatInputModules(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}

		const module = interaction.options.getString('module') as (typeof MODULES)[number] | null;
		const enabled = interaction.options.getBoolean('enabled');

		if (!module) {
			const row = await getOrCreateModules(interaction.guildId);
			const lines = MODULES.map((m) => `${row[m] ? '🟢' : '🔴'} **${MODULE_LABELS[m]}**`);
			return interaction.editReply(`### Module Status\n\n${lines.join('\n')}`);
		}

		if (enabled === null) {
			const row = await getOrCreateModules(interaction.guildId);
			const state = row[module] ? 'enabled 🟢' : 'disabled 🔴';
			return interaction.editReply(warningReply(`**${MODULE_LABELS[module]}** is currently ${state}.`));
		}

		await setModule(interaction.guildId, module, enabled);
		return interaction.editReply(
			successReply(`**${MODULE_LABELS[module]}** has been ${enabled ? 'enabled 🟢' : 'disabled 🔴'}.`),
		);
	}

	// ── /config logignore helpers ─────────────────────────────────────────────────
	private async getIgnored(guildId: string): Promise<string[]> {
		const [row] = await db.select().from(schema.guilds).where(eq(schema.guilds.id, guildId)).limit(1);
		return row?.logIgnoredChannelIds ? (JSON.parse(row.logIgnoredChannelIds) as string[]) : [];
	}

	private async setIgnored(guildId: string, ids: string[]): Promise<void> {
		await this.upsert(guildId, { logIgnoredChannelIds: JSON.stringify(ids) });
	}

	// ── /config logignore add ─────────────────────────────────────────────────────
	public async chatInputLogIgnoreAdd(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}

		const channel = interaction.options.getChannel('channel', true);
		const ignored = await this.getIgnored(interaction.guildId);

		if (ignored.includes(channel.id)) {
			return interaction.editReply(warningReply(`<#${channel.id}> is already excluded from general logs.`));
		}

		await this.setIgnored(interaction.guildId, [...ignored, channel.id]);
		return interaction.editReply(successReply(`<#${channel.id}> will no longer appear in general logs.`));
	}

	// ── /config logignore remove ──────────────────────────────────────────────────
	public async chatInputLogIgnoreRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}

		const channel = interaction.options.getChannel('channel', true);
		const ignored = await this.getIgnored(interaction.guildId);

		if (!ignored.includes(channel.id)) {
			return interaction.editReply(warningReply(`<#${channel.id}> is not currently excluded from general logs.`));
		}

		await this.setIgnored(
			interaction.guildId,
			ignored.filter((id) => id !== channel.id),
		);
		return interaction.editReply(successReply(`<#${channel.id}> will now appear in general logs again.`));
	}

	// ── /config logignore list ────────────────────────────────────────────────────
	public async chatInputLogIgnoreList(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}

		const ignored = await this.getIgnored(interaction.guildId);

		if (ignored.length === 0) {
			return interaction.editReply('No channels are currently excluded from general logs.');
		}

		const list = ignored.map((id) => `• <#${id}>`).join('\n');
		return interaction.editReply(`**Channels excluded from general logs:**\n${list}`);
	}

	// ── /config setttsrole ──────────────────────────────────────────────────────────
	public async chatInputSetTtsRole(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}

		const role = interaction.options.getRole('role');

		if (!role) {
			await this.upsert(interaction.guildId, { ttsRoleId: null });
			return interaction.editReply(
				successReply('TTS role cleared. Only Administrators and Guild Managers can use TTS.'),
			);
		}

		await this.upsert(interaction.guildId, { ttsRoleId: role.id });
		return interaction.editReply(successReply(`TTS role set to <@&${role.id}>.`));
	}

	// ── /config ttsconflict ──────────────────────────────────────────────────────────
	public async chatInputTtsConflict(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}

		const mode = interaction.options.getString('mode', true) as 'block' | 'interrupt';
		await this.upsert(interaction.guildId, { ttsConflictMode: mode });

		const modeLabel = mode === 'block' ? 'Block TTS (Default)' : 'Interrupt Music';
		return interaction.editReply(successReply(`TTS conflict mode set to **${modeLabel}**.`));
	}

	// ── /config ttslanguage ──────────────────────────────────────────────────────────
	public async chatInputTtsLanguage(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}

		const language = interaction.options.getString('language', true);
		await this.upsert(interaction.guildId, { ttsDefaultLanguage: language });

		return interaction.editReply(successReply(`Default TTS language set to **${language}**.`));
	}

	// ── suggestions handlers ───────────────────────────────────────────────────────
	public async chatInputSuggestionsSetupChannel(interaction: Subcommand.ChatInputCommandInteraction) {
		const { SuggestionHandler } = await import('../../lib/config/handlers/suggestion.js');
		return new SuggestionHandler().chatInputSetupChannel(interaction);
	}
	public async chatInputSuggestionsSetupDm(interaction: Subcommand.ChatInputCommandInteraction) {
		const { SuggestionHandler } = await import('../../lib/config/handlers/suggestion.js');
		return new SuggestionHandler().chatInputSetupDm(interaction);
	}
	public async chatInputSuggestionsApprove(interaction: Subcommand.ChatInputCommandInteraction) {
		const { SuggestionHandler } = await import('../../lib/config/handlers/suggestion.js');
		return new SuggestionHandler().chatInputApprove(interaction);
	}
	public async chatInputSuggestionsDeny(interaction: Subcommand.ChatInputCommandInteraction) {
		const { SuggestionHandler } = await import('../../lib/config/handlers/suggestion.js');
		return new SuggestionHandler().chatInputDeny(interaction);
	}
	public async chatInputSuggestionsImplement(interaction: Subcommand.ChatInputCommandInteraction) {
		const { SuggestionHandler } = await import('../../lib/config/handlers/suggestion.js');
		return new SuggestionHandler().chatInputImplement(interaction);
	}
}
