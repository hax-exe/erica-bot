import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import {
	ActivityType,
	type AutocompleteInteraction,
	MessageFlags,
	PermissionFlagsBits,
	PresenceUpdateStatus,
	TimestampStyles,
	time,
	userMention,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { invalidateBotBlacklistCache } from '../../lib/BlacklistUtil.js';
import { errorReply, successReply, warningReply } from '../../lib/components.js';
import {
	autocompleteColumns,
	autocompleteTables,
	buildResultReply,
	bulkSet,
	cloneRow,
	countRows,
	deleteRow,
	exportRows,
	formatPkHint,
	formatRowsJson,
	getRow,
	insertRow,
	listRows,
	listTableNames,
	patchRow,
	purgeRows,
	recentRows,
	resolveTable,
	searchRows,
	setColumn,
	tableStats,
} from '../../lib/DbAdminUtil.js';
import { db, schema } from '../../lib/database.js';
import {
	getGlobalModules,
	getOrCreateModules,
	MODULE_LABELS,
	MODULES,
	setGlobalModule,
	setModule,
} from '../../lib/ModuleUtil.js';
import { addMaintenanceUpdate, getMaintenance, reloadStatusConfig, setMaintenance } from '../../lib/StatusUtil.js';
import { updateTicketStatsChannels } from '../../lib/TicketStatsChannelUtil.js';
import { reloadTicketsConfig } from '../../lib/TicketsConfig.js';

function formatUptime(ms: number): string {
	const s = Math.floor(ms / 1000);
	const d = Math.floor(s / 86400);
	const h = Math.floor((s % 86400) / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	const parts: string[] = [];
	if (d) parts.push(`${d}d`);
	if (h || d) parts.push(`${h}h`);
	if (m || h || d) parts.push(`${m}m`);
	parts.push(`${sec}s`);
	return parts.join(' ');
}

function tableOption(o: any, required = true) {
	return o
		.setName('table')
		.setDescription('Schema table name (autocomplete).')
		.setRequired(required)
		.setAutocomplete(true);
}

@ApplyOptions<Subcommand.Options>({
	name: 'admin',
	description: 'Bot owner admin commands.',
	preconditions: ['BotAdmin'],
	subcommands: [
		{
			name: 'blacklist',
			type: 'group',
			entries: [
				{ name: 'add', chatInputRun: 'chatInputBlacklistAdd' },
				{ name: 'remove', chatInputRun: 'chatInputBlacklistRemove' },
				{ name: 'list', chatInputRun: 'chatInputBlacklistList' },
			],
		},
		{ name: 'modules', chatInputRun: 'chatInputModules' },
		{
			name: 'db',
			type: 'group',
			entries: [
				{ name: 'tables', chatInputRun: 'chatInputDbTables' },
				{ name: 'columns', chatInputRun: 'chatInputDbColumns' },
				{ name: 'stats', chatInputRun: 'chatInputDbStats' },
				{ name: 'count', chatInputRun: 'chatInputDbCount' },
				{ name: 'list', chatInputRun: 'chatInputDbList' },
				{ name: 'recent', chatInputRun: 'chatInputDbRecent' },
				{ name: 'search', chatInputRun: 'chatInputDbSearch' },
				{ name: 'export', chatInputRun: 'chatInputDbExport' },
				{ name: 'get', chatInputRun: 'chatInputDbGet' },
				{ name: 'set', chatInputRun: 'chatInputDbSet' },
				{ name: 'patch', chatInputRun: 'chatInputDbPatch' },
				{ name: 'insert', chatInputRun: 'chatInputDbInsert' },
				{ name: 'clone', chatInputRun: 'chatInputDbClone' },
				{ name: 'bulkset', chatInputRun: 'chatInputDbBulkSet' },
				{ name: 'delete', chatInputRun: 'chatInputDbDelete' },
				{ name: 'purge', chatInputRun: 'chatInputDbPurge' },
			],
		},
		{ name: 'info', chatInputRun: 'chatInputInfo' },
		{ name: 'guilds', chatInputRun: 'chatInputGuilds' },
		{ name: 'leave', chatInputRun: 'chatInputLeave' },
		{ name: 'say', chatInputRun: 'chatInputSay' },
		{ name: 'dm', chatInputRun: 'chatInputDm' },
		{ name: 'reload', chatInputRun: 'chatInputReload' },
		{ name: 'presence', chatInputRun: 'chatInputPresence' },
		{ name: 'invite', chatInputRun: 'chatInputInvite' },
		{ name: 'lookup', chatInputRun: 'chatInputLookup' },
		{
			name: 'maintenance',
			type: 'group',
			entries: [
				{ name: 'status', chatInputRun: 'chatInputMaintStatus' },
				{ name: 'on', chatInputRun: 'chatInputMaintOn' },
				{ name: 'off', chatInputRun: 'chatInputMaintOff' },
				{ name: 'update', chatInputRun: 'chatInputMaintUpdate' },
			],
		},
	],
})
export class AdminCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('admin')
				.setDescription('Bot owner admin commands.')
				// ── blacklist group ───────────────────────────────────────────────────
				.addSubcommandGroup((group) =>
					group
						.setName('blacklist')
						.setDescription('Manage the global bot user blacklist.')
						.addSubcommand((sub) =>
							sub
								.setName('add')
								.setDescription('Blacklist a user from using the bot globally.')
								.addUserOption((o) => o.setName('user').setDescription('The user to blacklist.').setRequired(true))
								.addStringOption((o) =>
									o.setName('reason').setDescription('Reason for the blacklist.').setRequired(false),
								),
						)
						.addSubcommand((sub) =>
							sub
								.setName('remove')
								.setDescription('Remove a user from the global blacklist.')
								.addUserOption((o) => o.setName('user').setDescription('The user to unblacklist.').setRequired(true)),
						)
						.addSubcommand((sub) => sub.setName('list').setDescription('List all globally blacklisted users.')),
				)
				// ── modules ───────────────────────────────────────────────────────────
				.addSubcommand((sub) =>
					sub
						.setName('modules')
						.setDescription('View or toggle modules globally or for a specific guild.')
						.addStringOption((o) =>
							o
								.setName('module')
								.setDescription('Module to toggle (omit to view all).')
								.setRequired(false)
								.addChoices(...MODULES.map((m) => ({ name: MODULE_LABELS[m], value: m }))),
						)
						.addBooleanOption((o) =>
							o.setName('enabled').setDescription('Enable or disable the module globally.').setRequired(false),
						)
						.addStringOption((o) =>
							o
								.setName('guild-id')
								.setDescription('Override for a specific guild only (omit for global).')
								.setRequired(false),
						),
				)
				// ── db group (structured table CRUD — no raw SQL) ─────────────────────
				.addSubcommandGroup((group) =>
					group
						.setName('db')
						.setDescription('Edit schema tables (bot owner). No raw SQL.')
						.addSubcommand((sub) => sub.setName('tables').setDescription('List whitelisted schema tables.'))
						.addSubcommand((sub) =>
							sub
								.setName('columns')
								.setDescription('Show columns for a table.')
								.addStringOption((o) => tableOption(o)),
						)
						.addSubcommand((sub) =>
							sub
								.setName('list')
								.setDescription('List rows from a table.')
								.addStringOption((o) => tableOption(o))
								.addIntegerOption((o) =>
									o
										.setName('limit')
										.setDescription('Max rows (default 20, max 50).')
										.setMinValue(1)
										.setMaxValue(50)
										.setRequired(false),
								)
								.addStringOption((o) =>
									o
										.setName('filter_column')
										.setDescription('Optional equality filter column.')
										.setRequired(false)
										.setAutocomplete(true),
								)
								.addStringOption((o) =>
									o.setName('filter_value').setDescription('Filter value (use null for SQL NULL).').setRequired(false),
								),
						)
						.addSubcommand((sub) =>
							sub
								.setName('get')
								.setDescription('Get one row by primary key.')
								.addStringOption((o) => tableOption(o))
								.addStringOption((o) =>
									o.setName('key').setDescription('PK value, or JSON object for composite keys.').setRequired(true),
								),
						)
						.addSubcommand((sub) =>
							sub
								.setName('set')
								.setDescription('Update one column on a row.')
								.addStringOption((o) => tableOption(o))
								.addStringOption((o) =>
									o.setName('key').setDescription('PK value, or JSON object for composite keys.').setRequired(true),
								)
								.addStringOption((o) =>
									o.setName('column').setDescription('Column to update.').setRequired(true).setAutocomplete(true),
								)
								.addStringOption((o) =>
									o.setName('value').setDescription('New value (null clears nullable fields).').setRequired(true),
								),
						)
						.addSubcommand((sub) =>
							sub
								.setName('insert')
								.setDescription('Insert a row from a JSON object.')
								.addStringOption((o) => tableOption(o))
								.addStringOption((o) =>
									o.setName('data').setDescription('JSON object of column → value.').setRequired(true),
								),
						)
						.addSubcommand((sub) =>
							sub
								.setName('delete')
								.setDescription('Delete a row by primary key.')
								.addStringOption((o) => tableOption(o))
								.addStringOption((o) =>
									o.setName('key').setDescription('PK value, or JSON object for composite keys.').setRequired(true),
								),
						)
						.addSubcommand((sub) => sub.setName('stats').setDescription('Row counts for every schema table.'))
						.addSubcommand((sub) =>
							sub
								.setName('count')
								.setDescription('Count rows in a table (optional filter).')
								.addStringOption((o) => tableOption(o))
								.addStringOption((o) =>
									o
										.setName('filter_column')
										.setDescription('Optional equality filter column.')
										.setRequired(false)
										.setAutocomplete(true),
								)
								.addStringOption((o) => o.setName('filter_value').setDescription('Filter value.').setRequired(false)),
						)
						.addSubcommand((sub) =>
							sub
								.setName('recent')
								.setDescription('Newest rows (by createdAt / datetime column).')
								.addStringOption((o) => tableOption(o))
								.addIntegerOption((o) =>
									o
										.setName('limit')
										.setDescription('Max rows (default 20, max 50).')
										.setMinValue(1)
										.setMaxValue(50)
										.setRequired(false),
								),
						)
						.addSubcommand((sub) =>
							sub
								.setName('search')
								.setDescription('Substring search on a text column.')
								.addStringOption((o) => tableOption(o))
								.addStringOption((o) =>
									o.setName('column').setDescription('Text column to search.').setRequired(true).setAutocomplete(true),
								)
								.addStringOption((o) => o.setName('query').setDescription('Substring to find.').setRequired(true))
								.addIntegerOption((o) =>
									o
										.setName('limit')
										.setDescription('Max rows (default 20, max 50).')
										.setMinValue(1)
										.setMaxValue(50)
										.setRequired(false),
								),
						)
						.addSubcommand((sub) =>
							sub
								.setName('export')
								.setDescription('Export rows as a JSON file (up to 2000).')
								.addStringOption((o) => tableOption(o))
								.addIntegerOption((o) =>
									o
										.setName('limit')
										.setDescription('Max rows (default 2000).')
										.setMinValue(1)
										.setMaxValue(2000)
										.setRequired(false),
								)
								.addStringOption((o) =>
									o
										.setName('filter_column')
										.setDescription('Optional equality filter column.')
										.setRequired(false)
										.setAutocomplete(true),
								)
								.addStringOption((o) => o.setName('filter_value').setDescription('Filter value.').setRequired(false)),
						)
						.addSubcommand((sub) =>
							sub
								.setName('patch')
								.setDescription('Update multiple columns on a row via JSON.')
								.addStringOption((o) => tableOption(o))
								.addStringOption((o) =>
									o.setName('key').setDescription('PK value, or JSON object for composite keys.').setRequired(true),
								)
								.addStringOption((o) =>
									o.setName('data').setDescription('JSON object of columns to update.').setRequired(true),
								),
						)
						.addSubcommand((sub) =>
							sub
								.setName('clone')
								.setDescription('Duplicate a row (new autoincrement PK).')
								.addStringOption((o) => tableOption(o))
								.addStringOption((o) => o.setName('key').setDescription('Source row PK.').setRequired(true))
								.addStringOption((o) =>
									o
										.setName('overrides')
										.setDescription('Optional JSON fields to change on the clone.')
										.setRequired(false),
								),
						)
						.addSubcommand((sub) =>
							sub
								.setName('bulkset')
								.setDescription('Set a column on many rows (filter or confirm_all).')
								.addStringOption((o) => tableOption(o))
								.addStringOption((o) =>
									o.setName('column').setDescription('Column to update.').setRequired(true).setAutocomplete(true),
								)
								.addStringOption((o) => o.setName('value').setDescription('New value.').setRequired(true))
								.addStringOption((o) =>
									o
										.setName('filter_column')
										.setDescription('Equality filter column.')
										.setRequired(false)
										.setAutocomplete(true),
								)
								.addStringOption((o) => o.setName('filter_value').setDescription('Filter value.').setRequired(false))
								.addBooleanOption((o) =>
									o
										.setName('confirm_all')
										.setDescription('Required to update every row when no filter.')
										.setRequired(false),
								),
						)
						.addSubcommand((sub) =>
							sub
								.setName('purge')
								.setDescription('Delete many rows (filter or confirm_all).')
								.addStringOption((o) => tableOption(o))
								.addStringOption((o) =>
									o
										.setName('filter_column')
										.setDescription('Equality filter column.')
										.setRequired(false)
										.setAutocomplete(true),
								)
								.addStringOption((o) => o.setName('filter_value').setDescription('Filter value.').setRequired(false))
								.addBooleanOption((o) =>
									o
										.setName('confirm_all')
										.setDescription('Required to delete every row when no filter.')
										.setRequired(false),
								),
						),
				)
				// ── runtime / ops ─────────────────────────────────────────────────────
				.addSubcommand((sub) => sub.setName('info').setDescription('Bot process and Discord stats.'))
				.addSubcommand((sub) =>
					sub
						.setName('guilds')
						.setDescription('List guilds the bot is in.')
						.addStringOption((o) => o.setName('query').setDescription('Filter by name or ID.').setRequired(false)),
				)
				.addSubcommand((sub) =>
					sub
						.setName('leave')
						.setDescription('Leave a guild by ID.')
						.addStringOption((o) => o.setName('guild-id').setDescription('Guild snowflake.').setRequired(true))
						.addBooleanOption((o) => o.setName('confirm').setDescription('Must be true to leave.').setRequired(true)),
				)
				.addSubcommand((sub) =>
					sub
						.setName('say')
						.setDescription('Send a message to a channel as the bot.')
						.addStringOption((o) =>
							o.setName('channel-id').setDescription('Target channel snowflake.').setRequired(true),
						)
						.addStringOption((o) => o.setName('message').setDescription('Message content.').setRequired(true)),
				)
				.addSubcommand((sub) =>
					sub
						.setName('dm')
						.setDescription('DM a user as the bot.')
						.addStringOption((o) => o.setName('user-id').setDescription('User snowflake.').setRequired(true))
						.addStringOption((o) => o.setName('message').setDescription('Message content.').setRequired(true)),
				)
				.addSubcommand((sub) => sub.setName('reload').setDescription('Reload tickets.yml and status.yml from disk.'))
				.addSubcommand((sub) =>
					sub
						.setName('presence')
						.setDescription('Set the bot presence / activity.')
						.addStringOption((o) =>
							o
								.setName('status')
								.setDescription('Online status.')
								.setRequired(false)
								.addChoices(
									{ name: 'Online', value: 'online' },
									{ name: 'Idle', value: 'idle' },
									{ name: 'Do Not Disturb', value: 'dnd' },
									{ name: 'Invisible', value: 'invisible' },
								),
						)
						.addStringOption((o) =>
							o
								.setName('type')
								.setDescription('Activity type.')
								.setRequired(false)
								.addChoices(
									{ name: 'Custom', value: 'custom' },
									{ name: 'Playing', value: 'playing' },
									{ name: 'Watching', value: 'watching' },
									{ name: 'Listening', value: 'listening' },
									{ name: 'Competing', value: 'competing' },
								),
						)
						.addStringOption((o) =>
							o.setName('text').setDescription('Activity / custom status text.').setRequired(false),
						)
						.addBooleanOption((o) =>
							o.setName('clear').setDescription('Clear activity (keep status if set).').setRequired(false),
						),
				)
				.addSubcommand((sub) =>
					sub.setName('invite').setDescription('Generate a bot invite URL with recommended permissions.'),
				)
				.addSubcommand((sub) =>
					sub
						.setName('lookup')
						.setDescription('Look up a user and mutual guilds.')
						.addStringOption((o) => o.setName('user-id').setDescription('User snowflake.').setRequired(true)),
				)
				.addSubcommandGroup((group) =>
					group
						.setName('maintenance')
						.setDescription('Global status-page maintenance mode.')
						.addSubcommand((sub) => sub.setName('status').setDescription('Show global maintenance state.'))
						.addSubcommand((sub) =>
							sub
								.setName('on')
								.setDescription('Enable global maintenance.')
								.addStringOption((o) =>
									o.setName('reason').setDescription('Reason shown on the status page.').setRequired(false),
								),
						)
						.addSubcommand((sub) => sub.setName('off').setDescription('Disable global maintenance.'))
						.addSubcommand((sub) =>
							sub
								.setName('update')
								.setDescription('Post a maintenance update to subscribers.')
								.addStringOption((o) => o.setName('message').setDescription('Update message.').setRequired(true)),
						),
				),
		);
	}

	public override async autocompleteRun(interaction: AutocompleteInteraction) {
		const group = interaction.options.getSubcommandGroup(false);
		if (group !== 'db') return interaction.respond([]);

		const focused = interaction.options.getFocused(true);
		if (focused.name === 'table') {
			return interaction.respond(autocompleteTables(focused.value));
		}

		const table = interaction.options.getString('table') ?? '';
		const sub = interaction.options.getSubcommand(true);
		if (focused.name === 'column') {
			const excludePk = sub === 'set' || sub === 'bulkset';
			return interaction.respond(autocompleteColumns(table, focused.value, { excludePk }));
		}
		if (focused.name === 'filter_column') {
			return interaction.respond(autocompleteColumns(table, focused.value));
		}

		return interaction.respond([]);
	}

	// ── /admin blacklist add ───────────────────────────────────────────────────────

	public async chatInputBlacklistAdd(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const target = interaction.options.getUser('user', true);
		const reason = interaction.options.getString('reason') ?? 'No reason provided';

		const ownerIds = (process.env.BOT_OWNER_IDS ?? '')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
		if (ownerIds.includes(target.id)) {
			return interaction.editReply(errorReply('You cannot blacklist a bot owner.'));
		}
		if (target.bot) {
			return interaction.editReply(errorReply('You cannot blacklist a bot account.'));
		}

		const existing = await db
			.select()
			.from(schema.botBlacklist)
			.where(eq(schema.botBlacklist.userId, target.id))
			.limit(1)
			.then((r) => r[0] ?? null);

		if (existing) {
			return interaction.editReply(warningReply(`${userMention(target.id)} is already blacklisted.`));
		}

		await db.insert(schema.botBlacklist).values({ userId: target.id, reason, addedById: interaction.user.id });
		invalidateBotBlacklistCache(target.id);

		return interaction.editReply(
			successReply(`**${target.tag}** (\`${target.id}\`) has been blacklisted.\nReason: ${reason}`),
		);
	}

	// ── /admin blacklist remove ────────────────────────────────────────────────────

	public async chatInputBlacklistRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const target = interaction.options.getUser('user', true);
		const result = await db.delete(schema.botBlacklist).where(eq(schema.botBlacklist.userId, target.id));
		const affected = Number((result as any)[0]?.affectedRows ?? 0);

		if (affected === 0) {
			return interaction.editReply(warningReply(`${userMention(target.id)} is not on the blacklist.`));
		}

		invalidateBotBlacklistCache(target.id);

		return interaction.editReply(
			successReply(`**${target.tag}** (\`${target.id}\`) has been removed from the blacklist.`),
		);
	}

	// ── /admin blacklist list ──────────────────────────────────────────────────────

	public async chatInputBlacklistList(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const entries = await db.select().from(schema.botBlacklist).orderBy(schema.botBlacklist.createdAt);
		if (entries.length === 0) {
			return interaction.editReply(warningReply('The blacklist is empty.'));
		}

		const lines = entries.map((e, i) => {
			const ts = time(Math.floor(e.createdAt.getTime() / 1000), TimestampStyles.ShortDate);
			return `\`${i + 1}.\` <@${e.userId}> (\`${e.userId}\`) — ${e.reason} — added by <@${e.addedById}> ${ts}`;
		});

		return interaction.editReply(
			`**Bot Blacklist** (${entries.length} entr${entries.length === 1 ? 'y' : 'ies'})\n\n${lines.join('\n')}`,
		);
	}

	// ── /admin modules ─────────────────────────────────────────────────────────────

	public async chatInputModules(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const module = interaction.options.getString('module') as (typeof MODULES)[number] | null;
		const enabled = interaction.options.getBoolean('enabled');
		const guildId = interaction.options.getString('guild-id')?.trim() ?? null;

		if (guildId && !/^\d{17,20}$/.test(guildId)) {
			return interaction.editReply(errorReply('Invalid guild ID — must be a Discord snowflake.'));
		}

		// ── View mode (no module provided) ──────────────────────────────────────
		if (!module) {
			if (guildId) {
				const row = await getOrCreateModules(guildId);
				const lines = MODULES.map((m) => `${row[m] ? '🟢' : '🔴'} **${MODULE_LABELS[m]}**`);
				return interaction.editReply(`### Module Status for \`${guildId}\`\n\n${lines.join('\n')}`);
			}
			const row = await getGlobalModules();
			const lines = MODULES.map((m) => `${row[m] ? '🟢' : '🔴'} **${MODULE_LABELS[m]}**`);
			return interaction.editReply(`### Global Module Status\n\n${lines.join('\n')}`);
		}

		// ── Status check (module provided, no enabled) ───────────────────────────
		if (enabled === null) {
			if (guildId) {
				const row = await getOrCreateModules(guildId);
				const state = row[module] ? 'enabled 🟢' : 'disabled 🔴';
				return interaction.editReply(warningReply(`**${MODULE_LABELS[module]}** is ${state} in \`${guildId}\`.`));
			}
			const row = await getGlobalModules();
			const state = row[module] ? 'enabled 🟢' : 'disabled 🔴';
			return interaction.editReply(warningReply(`**${MODULE_LABELS[module]}** is globally ${state}.`));
		}

		// ── Toggle ───────────────────────────────────────────────────────────────
		if (guildId) {
			await setModule(guildId, module, enabled);
			return interaction.editReply(
				successReply(`**${MODULE_LABELS[module]}** ${enabled ? 'enabled 🟢' : 'disabled 🔴'} for \`${guildId}\`.`),
			);
		}

		await setGlobalModule(module, enabled);
		return interaction.editReply(
			successReply(
				`**${MODULE_LABELS[module]}** globally ${enabled ? 'enabled 🟢' : 'disabled 🔴'}${!enabled ? ' — overrides all per-guild settings.' : '.'}`,
			),
		);
	}

	// ── /admin db tables ───────────────────────────────────────────────────────────

	public async chatInputDbTables(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const names = listTableNames();
		const lines = names.map((n) => {
			const meta = resolveTable(n);
			return `\`${n}\` — PK \`${formatPkHint(meta)}\` (${meta.columns.length} cols)`;
		});
		const body = lines.join('\n');
		if (body.length + 40 > 1900) {
			return interaction.editReply(buildResultReply(`Schema tables (${names.length})`, body, 'tables.txt'));
		}
		return interaction.editReply(`**Schema tables** (${names.length})\n\n${body}`);
	}

	// ── /admin db columns ──────────────────────────────────────────────────────────

	public async chatInputDbColumns(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		try {
			const table = interaction.options.getString('table', true);
			const meta = resolveTable(table);
			const lines = meta.columns.map((c) => {
				const flags = [c.primary ? 'PK' : null, c.notNull ? 'NOT NULL' : 'NULL', c.hasDefault ? 'DEFAULT' : null]
					.filter(Boolean)
					.join(', ');
				return `\`${c.key}\` · ${c.columnType.replace(/^MySql/, '')} · ${flags}`;
			});
			return interaction.editReply(`**\`${meta.name}\`** — PK \`${formatPkHint(meta)}\`\n\n${lines.join('\n')}`);
		} catch (err) {
			return interaction.editReply(errorReply(err instanceof Error ? err.message : 'Failed.'));
		}
	}

	// ── /admin db list ─────────────────────────────────────────────────────────────

	public async chatInputDbList(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		try {
			const table = interaction.options.getString('table', true);
			const limit = interaction.options.getInteger('limit') ?? undefined;
			const filterColumn = interaction.options.getString('filter_column');
			const filterValue = interaction.options.getString('filter_value');
			if (filterColumn && filterValue == null) {
				return interaction.editReply(errorReply('Provide `filter_value` when using `filter_column`.'));
			}
			const { meta, rows } = await listRows(table, { limit, filterColumn, filterValue });
			if (rows.length === 0) {
				return interaction.editReply(warningReply(`No rows in \`${meta.name}\`.`));
			}
			return interaction.editReply(
				buildResultReply(`\`${meta.name}\` (${rows.length} row${rows.length === 1 ? '' : 's'})`, formatRowsJson(rows)),
			);
		} catch (err) {
			return interaction.editReply(errorReply(err instanceof Error ? err.message : 'Failed.'));
		}
	}

	// ── /admin db get ──────────────────────────────────────────────────────────────

	public async chatInputDbGet(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		try {
			const table = interaction.options.getString('table', true);
			const key = interaction.options.getString('key', true);
			const { meta, row } = await getRow(table, key);
			return interaction.editReply(buildResultReply(`\`${meta.name}\` row`, formatRowsJson([row])));
		} catch (err) {
			return interaction.editReply(errorReply(err instanceof Error ? err.message : 'Failed.'));
		}
	}

	// ── /admin db set ──────────────────────────────────────────────────────────────

	public async chatInputDbSet(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		try {
			const table = interaction.options.getString('table', true);
			const key = interaction.options.getString('key', true);
			const column = interaction.options.getString('column', true);
			const value = interaction.options.getString('value', true);
			const { meta, row } = await setColumn(table, key, column, value, interaction.user.id);
			return interaction.editReply(buildResultReply(`Updated \`${meta.name}.${column}\``, formatRowsJson([row])));
		} catch (err) {
			return interaction.editReply(errorReply(err instanceof Error ? err.message : 'Failed.'));
		}
	}

	// ── /admin db insert ───────────────────────────────────────────────────────────

	public async chatInputDbInsert(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		try {
			const table = interaction.options.getString('table', true);
			const data = interaction.options.getString('data', true);
			const { meta, row, insertId } = await insertRow(table, data, interaction.user.id);
			if (row) {
				return interaction.editReply(buildResultReply(`Inserted into \`${meta.name}\``, formatRowsJson([row])));
			}
			return interaction.editReply(
				successReply(
					`Inserted into \`${meta.name}\`${insertId != null && insertId > 0 ? ` (insertId \`${insertId}\`)` : ''}.`,
				),
			);
		} catch (err) {
			return interaction.editReply(errorReply(err instanceof Error ? err.message : 'Failed.'));
		}
	}

	// ── /admin db delete ───────────────────────────────────────────────────────────

	public async chatInputDbDelete(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		try {
			const table = interaction.options.getString('table', true);
			const key = interaction.options.getString('key', true);
			const { meta, deleted } = await deleteRow(table, key, interaction.user.id);
			return interaction.editReply(buildResultReply(`Deleted from \`${meta.name}\``, formatRowsJson([deleted])));
		} catch (err) {
			return interaction.editReply(errorReply(err instanceof Error ? err.message : 'Failed.'));
		}
	}

	// ── /admin db stats ────────────────────────────────────────────────────────────

	public async chatInputDbStats(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		try {
			const stats = await tableStats();
			const total = stats.reduce((a, s) => a + s.count, 0);
			const lines = stats.map((s) => `\`${s.name}\` · **${s.count}** · PK \`${s.pk}\``);
			return interaction.editReply(
				buildResultReply(`Table stats (${stats.length} tables, ${total} rows)`, lines.join('\n'), 'stats.txt'),
			);
		} catch (err) {
			return interaction.editReply(errorReply(err instanceof Error ? err.message : 'Failed.'));
		}
	}

	// ── /admin db count ────────────────────────────────────────────────────────────

	public async chatInputDbCount(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		try {
			const table = interaction.options.getString('table', true);
			const filterColumn = interaction.options.getString('filter_column');
			const filterValue = interaction.options.getString('filter_value');
			const { meta, count } = await countRows(table, { filterColumn, filterValue });
			const filterNote = filterColumn ? ` where \`${filterColumn}\` = \`${filterValue}\`` : '';
			return interaction.editReply(
				successReply(`\`${meta.name}\` has **${count}** row${count === 1 ? '' : 's'}${filterNote}.`),
			);
		} catch (err) {
			return interaction.editReply(errorReply(err instanceof Error ? err.message : 'Failed.'));
		}
	}

	// ── /admin db recent ───────────────────────────────────────────────────────────

	public async chatInputDbRecent(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		try {
			const table = interaction.options.getString('table', true);
			const limit = interaction.options.getInteger('limit') ?? undefined;
			const { meta, rows, orderColumn } = await recentRows(table, { limit });
			if (rows.length === 0) return interaction.editReply(warningReply(`No rows in \`${meta.name}\`.`));
			return interaction.editReply(
				buildResultReply(`\`${meta.name}\` recent by \`${orderColumn}\` (${rows.length})`, formatRowsJson(rows)),
			);
		} catch (err) {
			return interaction.editReply(errorReply(err instanceof Error ? err.message : 'Failed.'));
		}
	}

	// ── /admin db search ───────────────────────────────────────────────────────────

	public async chatInputDbSearch(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		try {
			const table = interaction.options.getString('table', true);
			const column = interaction.options.getString('column', true);
			const query = interaction.options.getString('query', true);
			const limit = interaction.options.getInteger('limit') ?? undefined;
			const { meta, rows } = await searchRows(table, column, query, { limit });
			if (rows.length === 0) {
				return interaction.editReply(warningReply(`No matches in \`${meta.name}.${column}\` for \`${query}\`.`));
			}
			return interaction.editReply(
				buildResultReply(`\`${meta.name}.${column}\` ~ \`${query}\` (${rows.length})`, formatRowsJson(rows)),
			);
		} catch (err) {
			return interaction.editReply(errorReply(err instanceof Error ? err.message : 'Failed.'));
		}
	}

	// ── /admin db export ───────────────────────────────────────────────────────────

	public async chatInputDbExport(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		try {
			const table = interaction.options.getString('table', true);
			const limit = interaction.options.getInteger('limit') ?? undefined;
			const filterColumn = interaction.options.getString('filter_column');
			const filterValue = interaction.options.getString('filter_value');
			const { meta, rows, truncated } = await exportRows(table, { limit, filterColumn, filterValue });
			const body = formatRowsJson(rows);
			const note = truncated ? ' (truncated at limit)' : '';
			return interaction.editReply({
				content: `**Export \`${meta.name}\`** — ${rows.length} row${rows.length === 1 ? '' : 's'}${note}`,
				files: [
					{
						attachment: Buffer.from(body, 'utf8'),
						name: `${meta.name}.json`,
					},
				],
			});
		} catch (err) {
			return interaction.editReply(errorReply(err instanceof Error ? err.message : 'Failed.'));
		}
	}

	// ── /admin db patch ────────────────────────────────────────────────────────────

	public async chatInputDbPatch(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		try {
			const table = interaction.options.getString('table', true);
			const key = interaction.options.getString('key', true);
			const data = interaction.options.getString('data', true);
			const { meta, row } = await patchRow(table, key, data, interaction.user.id);
			return interaction.editReply(buildResultReply(`Patched \`${meta.name}\``, formatRowsJson([row])));
		} catch (err) {
			return interaction.editReply(errorReply(err instanceof Error ? err.message : 'Failed.'));
		}
	}

	// ── /admin db clone ────────────────────────────────────────────────────────────

	public async chatInputDbClone(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		try {
			const table = interaction.options.getString('table', true);
			const key = interaction.options.getString('key', true);
			const overrides = interaction.options.getString('overrides');
			const { meta, row, insertId } = await cloneRow(table, key, interaction.user.id, overrides);
			if (row) {
				return interaction.editReply(buildResultReply(`Cloned \`${meta.name}\``, formatRowsJson([row])));
			}
			return interaction.editReply(
				successReply(
					`Cloned \`${meta.name}\`${insertId != null && insertId > 0 ? ` (insertId \`${insertId}\`)` : ''}.`,
				),
			);
		} catch (err) {
			return interaction.editReply(errorReply(err instanceof Error ? err.message : 'Failed.'));
		}
	}

	// ── /admin db bulkset ──────────────────────────────────────────────────────────

	public async chatInputDbBulkSet(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		try {
			const table = interaction.options.getString('table', true);
			const column = interaction.options.getString('column', true);
			const value = interaction.options.getString('value', true);
			const filterColumn = interaction.options.getString('filter_column');
			const filterValue = interaction.options.getString('filter_value');
			const confirmAll = interaction.options.getBoolean('confirm_all') ?? false;
			const { meta, affected } = await bulkSet(table, column, value, interaction.user.id, {
				filterColumn,
				filterValue,
				confirmAll,
			});
			return interaction.editReply(
				successReply(`Updated **${affected}** row${affected === 1 ? '' : 's'} on \`${meta.name}.${column}\`.`),
			);
		} catch (err) {
			return interaction.editReply(errorReply(err instanceof Error ? err.message : 'Failed.'));
		}
	}

	// ── /admin db purge ────────────────────────────────────────────────────────────

	public async chatInputDbPurge(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		try {
			const table = interaction.options.getString('table', true);
			const filterColumn = interaction.options.getString('filter_column');
			const filterValue = interaction.options.getString('filter_value');
			const confirmAll = interaction.options.getBoolean('confirm_all') ?? false;
			const { meta, affected } = await purgeRows(table, interaction.user.id, {
				filterColumn,
				filterValue,
				confirmAll,
			});
			return interaction.editReply(
				successReply(`Purged **${affected}** row${affected === 1 ? '' : 's'} from \`${meta.name}\`.`),
			);
		} catch (err) {
			return interaction.editReply(errorReply(err instanceof Error ? err.message : 'Failed.'));
		}
	}

	// ── /admin info ────────────────────────────────────────────────────────────────

	public async chatInputInfo(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const client = interaction.client;
		const mem = process.memoryUsage();
		const guilds = client.guilds.cache.size;
		const users = client.guilds.cache.reduce((n, g) => n + g.memberCount, 0);
		const channels = client.channels.cache.size;
		const ping = Math.round(client.ws.ping);
		const lines = [
			`**Uptime** ${formatUptime(client.uptime ?? 0)}`,
			`**Ping** ${ping} ms`,
			`**Guilds** ${guilds}`,
			`**Members (approx)** ${users.toLocaleString()}`,
			`**Cached channels** ${channels}`,
			`**Heap** ${(mem.heapUsed / 1024 / 1024).toFixed(1)} / ${(mem.heapTotal / 1024 / 1024).toFixed(1)} MiB`,
			`**RSS** ${(mem.rss / 1024 / 1024).toFixed(1)} MiB`,
			`**Node** ${process.version}`,
			`**PID** ${process.pid}`,
		];
		return interaction.editReply(`### Bot info\n\n${lines.join('\n')}`);
	}

	// ── /admin guilds ──────────────────────────────────────────────────────────────

	public async chatInputGuilds(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const q = interaction.options.getString('query')?.trim().toLowerCase() ?? '';
		let guilds = [...interaction.client.guilds.cache.values()].sort((a, b) => b.memberCount - a.memberCount);
		if (q) {
			guilds = guilds.filter((g) => g.id.includes(q) || g.name.toLowerCase().includes(q));
		}
		if (guilds.length === 0) {
			return interaction.editReply(warningReply(q ? 'No guilds matched that query.' : 'Bot is in no guilds.'));
		}
		const lines = guilds.map(
			(g, i) => `\`${i + 1}.\` **${g.name}** — \`${g.id}\` — ${g.memberCount.toLocaleString()} members`,
		);
		return interaction.editReply(buildResultReply(`Guilds (${guilds.length})`, lines.join('\n'), 'guilds.txt'));
	}

	// ── /admin leave ───────────────────────────────────────────────────────────────

	public async chatInputLeave(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const guildId = interaction.options.getString('guild-id', true).trim();
		const confirm = interaction.options.getBoolean('confirm', true);
		if (!/^\d{17,20}$/.test(guildId)) {
			return interaction.editReply(errorReply('Invalid guild ID.'));
		}
		if (!confirm) {
			return interaction.editReply(warningReply('Set `confirm` to true to leave the guild.'));
		}
		const guild =
			interaction.client.guilds.cache.get(guildId) ??
			(await interaction.client.guilds.fetch(guildId).catch(() => null));
		if (!guild) {
			return interaction.editReply(errorReply(`Not in guild \`${guildId}\`.`));
		}
		const name = guild.name;
		await guild.leave();
		return interaction.editReply(successReply(`Left **${name}** (\`${guildId}\`).`));
	}

	// ── /admin say ─────────────────────────────────────────────────────────────────

	public async chatInputSay(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const channelId = interaction.options.getString('channel-id', true).trim();
		const message = interaction.options.getString('message', true);
		if (!/^\d{17,20}$/.test(channelId)) {
			return interaction.editReply(errorReply('Invalid channel ID.'));
		}
		const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
		if (!channel || !channel.isTextBased() || channel.isDMBased() || !('send' in channel)) {
			return interaction.editReply(errorReply('Channel not found or is not a sendable guild text channel.'));
		}
		const sent = await channel.send({ content: message });
		return interaction.editReply(successReply(`Sent in <#${channel.id}> — [jump](${sent.url}).`));
	}

	// ── /admin dm ──────────────────────────────────────────────────────────────────

	public async chatInputDm(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const userId = interaction.options.getString('user-id', true).trim();
		const message = interaction.options.getString('message', true);
		if (!/^\d{17,20}$/.test(userId)) {
			return interaction.editReply(errorReply('Invalid user ID.'));
		}
		const user = await interaction.client.users.fetch(userId).catch(() => null);
		if (!user) return interaction.editReply(errorReply('User not found.'));
		if (user.bot) return interaction.editReply(errorReply('Cannot DM a bot.'));
		try {
			await user.send({ content: message });
		} catch {
			return interaction.editReply(errorReply(`Could not DM **${user.tag}** — DMs closed or blocked.`));
		}
		return interaction.editReply(successReply(`DM sent to **${user.tag}** (\`${user.id}\`).`));
	}

	// ── /admin reload ──────────────────────────────────────────────────────────────

	public async chatInputReload(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const notes: string[] = [];
		try {
			const tickets = reloadTicketsConfig();
			const guildId = tickets.settings.guildId;
			notes.push(`tickets.yml — guild \`${guildId ?? 'any'}\`, ${tickets.categories.length} categories`);
			if (interaction.inCachedGuild() && (!guildId || interaction.guildId === guildId)) {
				await updateTicketStatsChannels(interaction.guild).catch(() => null);
			}
		} catch (err) {
			notes.push(`tickets.yml — failed: ${err instanceof Error ? err.message : String(err)}`);
		}
		try {
			const status = reloadStatusConfig();
			const serviceCount = status.categories.reduce((n, c) => n + c.services.length, 0);
			notes.push(`status.yml — ${status.categories.length} categories, ${serviceCount} services`);
		} catch (err) {
			notes.push(`status.yml — failed: ${err instanceof Error ? err.message : String(err)}`);
		}
		return interaction.editReply(successReply(`Configs reloaded:\n${notes.map((n) => `• ${n}`).join('\n')}`));
	}

	// ── /admin presence ────────────────────────────────────────────────────────────

	public async chatInputPresence(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const statusRaw = interaction.options.getString('status');
		const typeRaw = interaction.options.getString('type');
		const text = interaction.options.getString('text');
		const clear = interaction.options.getBoolean('clear') ?? false;

		const statusMap = {
			online: PresenceUpdateStatus.Online,
			idle: PresenceUpdateStatus.Idle,
			dnd: PresenceUpdateStatus.DoNotDisturb,
			invisible: PresenceUpdateStatus.Invisible,
		} as const;

		const typeMap = {
			custom: ActivityType.Custom,
			playing: ActivityType.Playing,
			watching: ActivityType.Watching,
			listening: ActivityType.Listening,
			competing: ActivityType.Competing,
		} as const;

		if (!statusRaw && !typeRaw && !text && !clear) {
			return interaction.editReply(warningReply('Provide `status`, `type`/`text`, or `clear`.'));
		}
		if (!clear && (typeRaw || text) && !(typeRaw && text)) {
			return interaction.editReply(errorReply('Activity needs both `type` and `text` (or use `clear`).'));
		}

		const payload: {
			status?: (typeof statusMap)[keyof typeof statusMap];
			activities?: { name: string; type: ActivityType; state?: string }[];
		} = {};

		if (statusRaw && statusRaw in statusMap) {
			payload.status = statusMap[statusRaw as keyof typeof statusMap];
		}

		if (clear) {
			payload.activities = [];
		} else if (typeRaw && text) {
			const type = typeMap[typeRaw as keyof typeof typeMap];
			if (type === ActivityType.Custom) {
				payload.activities = [{ name: 'Custom Status', type, state: text }];
			} else {
				payload.activities = [{ name: text, type }];
			}
		}

		interaction.client.user.setPresence(payload);
		const bits: string[] = [];
		if (payload.status) bits.push(`status **${statusRaw}**`);
		if (clear) bits.push('activity cleared');
		else if (payload.activities?.[0]) bits.push(`activity **${typeRaw}**: ${text}`);
		return interaction.editReply(successReply(`Presence updated — ${bits.join(', ')}.`));
	}

	// ── /admin invite ──────────────────────────────────────────────────────────────

	public async chatInputInvite(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const appId = interaction.client.application?.id ?? interaction.client.user.id;
		const perms = [
			PermissionFlagsBits.Administrator, // owners typically want full setup; also offer note
		];
		// Prefer a practical non-admin invite for sharing; keep admin as optional second link
		const recommended =
			PermissionFlagsBits.ViewChannel |
			PermissionFlagsBits.SendMessages |
			PermissionFlagsBits.EmbedLinks |
			PermissionFlagsBits.AttachFiles |
			PermissionFlagsBits.ManageMessages |
			PermissionFlagsBits.ManageChannels |
			PermissionFlagsBits.ManageRoles |
			PermissionFlagsBits.KickMembers |
			PermissionFlagsBits.BanMembers |
			PermissionFlagsBits.ModerateMembers |
			PermissionFlagsBits.ManageNicknames |
			PermissionFlagsBits.ReadMessageHistory |
			PermissionFlagsBits.AddReactions |
			PermissionFlagsBits.UseExternalEmojis |
			PermissionFlagsBits.Connect |
			PermissionFlagsBits.Speak |
			PermissionFlagsBits.MoveMembers |
			PermissionFlagsBits.CreatePublicThreads |
			PermissionFlagsBits.CreatePrivateThreads |
			PermissionFlagsBits.SendMessagesInThreads |
			PermissionFlagsBits.ManageThreads |
			PermissionFlagsBits.MentionEveryone;

		const scopes = 'bot%20applications.commands';
		const normal = `https://discord.com/api/oauth2/authorize?client_id=${appId}&permissions=${recommended}&scope=${scopes}`;
		const admin = `https://discord.com/api/oauth2/authorize?client_id=${appId}&permissions=${perms[0]}&scope=${scopes}`;
		return interaction.editReply(
			`**Invite links**\n• [Recommended permissions](${normal})\n• [Administrator](${admin})`,
		);
	}

	// ── /admin lookup ──────────────────────────────────────────────────────────────

	public async chatInputLookup(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const userId = interaction.options.getString('user-id', true).trim();
		if (!/^\d{17,20}$/.test(userId)) {
			return interaction.editReply(errorReply('Invalid user ID.'));
		}
		const user = await interaction.client.users.fetch(userId).catch(() => null);
		if (!user) return interaction.editReply(errorReply('User not found.'));

		const mutual: string[] = [];
		for (const guild of interaction.client.guilds.cache.values()) {
			const member = guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));
			if (member) mutual.push(`**${guild.name}** (\`${guild.id}\`)`);
		}

		const created = time(Math.floor(user.createdTimestamp / 1000), TimestampStyles.ShortDateTime);
		const lines = [
			`**User** ${user.tag} (\`${user.id}\`)`,
			`**Bot** ${user.bot ? 'yes' : 'no'}`,
			`**Created** ${created}`,
			`**Mutual guilds** ${mutual.length}`,
			...(mutual.length ? mutual.map((m) => `• ${m}`) : ['• None cached']),
		];
		return interaction.editReply(buildResultReply('User lookup', lines.join('\n'), 'lookup.txt'));
	}

	// ── /admin maintenance ─────────────────────────────────────────────────────────

	public async chatInputMaintStatus(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const row = await getMaintenance();
		if (!row?.enabled) {
			return interaction.editReply(warningReply('Global maintenance is **off**.'));
		}
		const started = row.startedAt
			? time(Math.floor(row.startedAt.getTime() / 1000), TimestampStyles.RelativeTime)
			: 'unknown';
		return interaction.editReply(
			successReply(`Global maintenance is **on**.\n**Reason** ${row.reason ?? '—'}\n**Started** ${started}`),
		);
	}

	public async chatInputMaintOn(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const reason = interaction.options.getString('reason') ?? 'Scheduled maintenance';
		await setMaintenance({ enabled: true, reason, startedAt: new Date() });
		return interaction.editReply(successReply(`Global maintenance **enabled**.\nReason: ${reason}`));
	}

	public async chatInputMaintOff(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		await setMaintenance({ enabled: false, reason: null, startedAt: null, updates: '[]' });
		return interaction.editReply(successReply('Global maintenance **disabled**.'));
	}

	public async chatInputMaintUpdate(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const message = interaction.options.getString('message', true);
		const row = await getMaintenance();
		if (!row?.enabled) {
			return interaction.editReply(
				warningReply('Global maintenance is off — enable it first with `/admin maintenance on`.'),
			);
		}
		await addMaintenanceUpdate(message);
		return interaction.editReply(successReply('Maintenance update posted to subscribers.'));
	}
}
