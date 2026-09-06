import { ApplyOptions } from '@sapphire/decorators';
import type { Command } from '@sapphire/framework';
import { Subcommand } from '@sapphire/plugin-subcommands';
import {
	ActionRowBuilder,
	AttachmentBuilder,
	ButtonBuilder,
	ButtonStyle,
	MessageFlags,
	PermissionFlagsBits,
	StringSelectMenuBuilder,
	StringSelectMenuOptionBuilder,
	TextDisplayBuilder,
	userMention,
} from 'discord.js';
import { and, eq, gte } from 'drizzle-orm';
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
import { sendModLog } from '../../lib/LoggingUtil.js';
import {
	createNote,
	deleteInfraction,
	getInfractionByCase,
	getInfractions,
	getNotes,
	updateInfractionReason,
} from '../../lib/ModerationUtil.js';
import {
	buildActiveTimeoutsPage,
	buildCasesPage,
	buildMyWarningsPage,
	buildWarningsPage,
} from '../../listeners/paginationInteractions.js';

@ApplyOptions<Subcommand.Options>({
	name: 'case',
	description: 'View or edit a moderation case.',
	preconditions: ['Moderation'],
	subcommands: [
		{ name: 'view', chatInputRun: 'runView' },
		{ name: 'edit', chatInputRun: 'runEdit' },
		{ name: 'delete', chatInputRun: 'runDelete' },
		{ name: 'proof', chatInputRun: 'runProof' },
		{ name: 'bans', chatInputRun: 'runBans' },
		{ name: 'list', chatInputRun: 'runList' },
		{ name: 'combine', chatInputRun: 'runCombine' },
		{
			name: 'note',
			type: 'group',
			entries: [
				{ name: 'add', chatInputRun: 'runNoteAdd' },
				{ name: 'view', chatInputRun: 'runNoteView' },
			],
		},
		{
			name: 'timeouts',
			type: 'group',
			entries: [
				{ name: 'list', chatInputRun: 'runTimeoutsList' },
				{ name: 'clear-all', chatInputRun: 'runTimeoutsClearAll' },
			],
		},
		{
			name: 'warnings',
			type: 'group',
			entries: [
				{ name: 'view', chatInputRun: 'runWarningsView' },
				{ name: 'clear', chatInputRun: 'runWarningsClear' },
				{ name: 'export', chatInputRun: 'runWarningsExport' },
				{ name: 'mine', chatInputRun: 'runWarningsMine' },
			],
		},
		{
			name: 'modstats',
			type: 'group',
			entries: [
				{ name: 'view', chatInputRun: 'runModStatsView' },
				{ name: 'export', chatInputRun: 'runModStatsExport' },
			],
		},
	],
})
export class CaseCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('case')
				.setDescription('View or edit a moderation case.')
				.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
				// view
				.addSubcommand((sub) =>
					sub
						.setName('view')
						.setDescription('View full details of a moderation case.')
						.addStringOption((o) =>
							o
								.setName('id')
								.setDescription('Case ID (e.g. JVDuXXa).')
								.setRequired(true)
								.setMaxLength(20)
								.setAutocomplete(true),
						),
				)
				// edit
				.addSubcommand((sub) =>
					sub
						.setName('edit')
						.setDescription('Update the reason on an existing case.')
						.addStringOption((o) =>
							o
								.setName('id')
								.setDescription('Case ID to edit.')
								.setRequired(true)
								.setMaxLength(20)
								.setAutocomplete(true),
						)
						.addStringOption((o) =>
							o.setName('reason').setDescription('New reason.').setRequired(true).setMaxLength(500),
						),
				)
				// delete
				.addSubcommand((sub) =>
					sub
						.setName('delete')
						.setDescription('Delete a moderation case.')
						.addStringOption((o) =>
							o
								.setName('id')
								.setDescription('Case ID to delete.')
								.setRequired(true)
								.setMaxLength(20)
								.setAutocomplete(true),
						),
				)
				// proof
				.addSubcommand((sub) =>
					sub
						.setName('proof')
						.setDescription('Add or update the proof URL on an existing case.')
						.addStringOption((o) =>
							o
								.setName('id')
								.setDescription('Case ID to update.')
								.setRequired(true)
								.setMaxLength(20)
								.setAutocomplete(true),
						)
						.addStringOption((o) =>
							o.setName('url').setDescription('Proof image or link URL.').setRequired(true).setMaxLength(500),
						),
				)
				// bans (originally /bans)
				.addSubcommand((sub) =>
					sub
						.setName('bans')
						.setDescription('List banned users in this server.')
						.addStringOption((o) => o.setName('search').setDescription('Filter by username.').setRequired(false))
						.addStringOption((o) =>
							o
								.setName('filter')
								.setDescription('Filter by ban type.')
								.setRequired(false)
								.addChoices({ name: 'All Bans', value: 'all' }, { name: 'Temporary Bans Only', value: 'temporary' }),
						)
						.addStringOption((o) =>
							o.setName('reason_search').setDescription('Filter bans by reason keyword.').setRequired(false),
						),
				)
				// list (originally /cases)
				.addSubcommand((sub) =>
					sub
						.setName('list')
						.setDescription('View a rolling feed of moderation infractions on this server.')
						.addStringOption((o) =>
							o
								.setName('type')
								.setDescription('Filter by infraction type.')
								.setRequired(false)
								.addChoices(
									{ name: 'Warning', value: 'warn' },
									{ name: 'Timeout', value: 'timeout' },
									{ name: 'Kick', value: 'kick' },
									{ name: 'Ban', value: 'ban' },
									{ name: 'Unban', value: 'unban' },
									{ name: 'Softban', value: 'softban' },
									{ name: 'Untimeout', value: 'untimeout' },
								),
						)
						.addUserOption((o) => o.setName('user').setDescription('Filter by the targeted user.').setRequired(false))
						.addUserOption((o) =>
							o.setName('moderator').setDescription('Filter by the moderator who took action.').setRequired(false),
						),
				)
				// note group
				.addSubcommandGroup((group) =>
					group
						// combine
						.addSubcommand((sub) =>
							sub
								.setName('combine')
								.setDescription('Combine multiple cases into a single case.')
								.addStringOption((o) =>
									o
										.setName('target')
										.setDescription('Target Case ID to merge into.')
										.setRequired(true)
										.setMaxLength(20)
										.setAutocomplete(true),
								)
								.addStringOption((o) =>
									o
										.setName('cases')
										.setDescription('Space/comma-separated list of case IDs to merge.')
										.setRequired(true)
										.setMaxLength(500),
								),
						)
						.setName('note')
						.setDescription('Manage case notes.')
						.addSubcommand((sub) =>
							sub
								.setName('add')
								.setDescription('Add a note to a case.')
								.addStringOption((o) =>
									o.setName('id').setDescription('Case ID.').setRequired(true).setMaxLength(20).setAutocomplete(true),
								)
								.addStringOption((o) =>
									o.setName('note').setDescription('Note content.').setRequired(true).setMaxLength(500),
								),
						)
						.addSubcommand((sub) =>
							sub
								.setName('view')
								.setDescription('View notes on a case.')
								.addStringOption((o) =>
									o.setName('id').setDescription('Case ID.').setRequired(true).setMaxLength(20).setAutocomplete(true),
								),
						),
				)
				// timeouts group
				.addSubcommandGroup((group) =>
					group
						.setName('timeouts')
						.setDescription('Manage active timeouts.')
						.addSubcommand((sub) =>
							sub
								.setName('list')
								.setDescription('List active timeouts')
								.addUserOption((o) => o.setName('user').setDescription('Filter by user').setRequired(false))
								.addIntegerOption((o) =>
									o.setName('page').setDescription('Page number').setRequired(false).setMinValue(1),
								),
						)
						.addSubcommand((sub) => sub.setName('clear-all').setDescription('Clear all active timeouts')),
				)
				// warnings group (originally /warnings)
				.addSubcommandGroup((group) =>
					group
						.setName('warnings')
						.setDescription('Infraction and warning history management.')
						.addSubcommand((sub) =>
							sub
								.setName('view')
								.setDescription("View a member's moderation history.")
								.addUserOption((o) => o.setName('user').setDescription('The member to look up.').setRequired(true)),
						)
						.addSubcommand((sub) =>
							sub.setName('mine').setDescription('View your own warnings and infractions on this server.'),
						)
						.addSubcommand((sub) =>
							sub
								.setName('export')
								.setDescription("Export a user's infraction history as a text file.")
								.addUserOption((o) =>
									o.setName('user').setDescription('The user whose history to export.').setRequired(true),
								),
						)
						.addSubcommand((sub) =>
							sub
								.setName('clear')
								.setDescription('Clear one or all infractions from a member.')
								.addUserOption((o) =>
									o.setName('user').setDescription('The member whose infractions to clear.').setRequired(true),
								)
								.addStringOption((o) =>
									o
										.setName('case')
										.setDescription('Specific case to remove (omit to clear all).')
										.setAutocomplete(true)
										.setRequired(false),
								)
								.addStringOption((o) =>
									o
										.setName('scope')
										.setDescription('Which infractions to clear when no case is specified (default: warnings only).')
										.setRequired(false)
										.addChoices({ name: 'Warnings only', value: 'warn' }, { name: 'All infractions', value: 'all' }),
								)
								.addUserOption((o) =>
									o
										.setName('moderator')
										.setDescription('Only clear infractions issued by this moderator.')
										.setRequired(false),
								)
								.addStringOption((o) =>
									o
										.setName('reason_search')
										.setDescription('Only clear infractions matching this keyword.')
										.setRequired(false),
								)
								.addStringOption((o) =>
									o
										.setName('type')
										.setDescription('Only clear infractions of this type.')
										.setRequired(false)
										.addChoices(
											{ name: 'Warn', value: 'warn' },
											{ name: 'Timeout', value: 'timeout' },
											{ name: 'Ban', value: 'ban' },
											{ name: 'Kick', value: 'kick' },
											{ name: 'Softban', value: 'softban' },
										),
								)
								.addStringOption((o) =>
									o
										.setName('timeframe')
										.setDescription('Only clear infractions from this time period.')
										.setRequired(false)
										.addChoices(
											{ name: 'Past hour', value: '1h' },
											{ name: 'Past 24 hours', value: '24h' },
											{ name: 'Past 7 days', value: '7d' },
											{ name: 'Past 30 days', value: '30d' },
										),
								)
								.addBooleanOption((o) =>
									o.setName('dry_run').setDescription('Verify matching count without deleting.').setRequired(false),
								),
						),
				)
				// modstats group
				.addSubcommandGroup((group) =>
					group
						.setName('modstats')
						.setDescription('View moderation action statistics.')
						.addSubcommand((sub) =>
							sub
								.setName('view')
								.setDescription('View moderation stats leaderboard or for a specific moderator.')
								.addUserOption((o) =>
									o.setName('moderator').setDescription('Show stats for a specific moderator.').setRequired(false),
								)
								.addStringOption((o) =>
									o
										.setName('timeframe')
										.setDescription('Time period to inspect (default: Lifetime).')
										.setRequired(false)
										.addChoices(
											{ name: 'Lifetime', value: 'all' },
											{ name: 'Past 7 days', value: '7d' },
											{ name: 'Past 30 days', value: '30d' },
										),
								),
						)
						.addSubcommand((sub) =>
							sub
								.setName('export')
								.setDescription('Export a CSV of moderation activity.')
								.addStringOption((o) =>
									o
										.setName('timeframe')
										.setDescription('Time period to export (default: Lifetime).')
										.setRequired(false)
										.addChoices(
											{ name: 'Lifetime', value: 'all' },
											{ name: 'Past 7 days', value: '7d' },
											{ name: 'Past 30 days', value: '30d' },
										),
								),
						),
				),
		);
	}

	public override async autocompleteRun(interaction: Command.AutocompleteInteraction) {
		if (!interaction.inCachedGuild()) return interaction.respond([]);
		const group = interaction.options.getSubcommandGroup(false);
		const subcommand = interaction.options.getSubcommand(true);

		if (group === 'warnings' && subcommand === 'clear') {
			const userId = interaction.options.get('user')?.value as string | undefined;
			if (!userId) return interaction.respond([]);

			const focused = interaction.options.getFocused().toLowerCase();
			const infractions = await getInfractions(interaction.guildId, userId);

			const choices = infractions
				.filter((inf) => inf.caseId.toLowerCase().includes(focused) || inf.type.includes(focused))
				.slice(0, 25)
				.map((inf) => ({
					name: `${inf.caseId} — ${inf.type.toUpperCase()} (${inf.reason.slice(0, 40)}${inf.reason.length > 40 ? '…' : ''})`,
					value: inf.caseId,
				}));

			return interaction.respond(choices);
		}

		const focused = interaction.options.getFocused();
		const { db, schema } = await import('../../lib/database.js');
		const { and, eq, like, desc } = await import('drizzle-orm');

		const results = await db
			.select({ caseId: schema.infractions.caseId, type: schema.infractions.type })
			.from(schema.infractions)
			.where(and(eq(schema.infractions.guildId, interaction.guildId), like(schema.infractions.caseId, `%${focused}%`)))
			.orderBy(desc(schema.infractions.createdAt))
			.limit(25);

		return interaction.respond(
			results.map((r) => ({
				name: `${r.caseId} (${r.type.toUpperCase()})`,
				value: r.caseId,
			})),
		);
	}

	public async runView(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const caseId = interaction.options.getString('id', true).trim();
		const infraction = await getInfractionByCase(interaction.guildId, caseId);

		if (!infraction) return interaction.editReply(errorReply(`No case found with ID \`${caseId}\`.`));

		const ts = Math.floor(new Date(infraction.createdAt).getTime() / 1000);

		const container = makeContainer({
			color: Colors.Info,
			header: `Case \`${infraction.caseId}\` — ${infraction.type.toUpperCase()}`,
		});

		container.addSeparatorComponents(separator());

		// Find linked cases
		let linkedCaseText = '';
		if (infraction.linkedCaseId) {
			const targetCase = await getInfractionByCase(interaction.guildId, infraction.linkedCaseId);
			if (targetCase) {
				linkedCaseText = `**Linked Case** \`${targetCase.caseId}\` (${targetCase.type.toUpperCase()}) — View via \`/case view id:${targetCase.caseId}\``;
			} else {
				linkedCaseText = `**Linked Case** \`${infraction.linkedCaseId}\``;
			}
		} else {
			// Check if another case links to this case (e.g. if this is a ban, find the unban)
			const [linkedCase] = await db
				.select()
				.from(schema.infractions)
				.where(
					and(
						eq(schema.infractions.guildId, interaction.guildId),
						eq(schema.infractions.linkedCaseId, infraction.caseId),
					),
				)
				.limit(1);

			if (linkedCase) {
				const liftTs = Math.floor(new Date(linkedCase.createdAt).getTime() / 1000);
				linkedCaseText = `**Status** Lifted (Case \`${linkedCase.caseId}\` — ${linkedCase.type.toUpperCase()}) by <@${linkedCase.moderatorId}> (<t:${liftTs}:R>)\n**Lift Reason** ${linkedCase.reason}`;
			}
		}

		const lines = [
			`**User** ${userMention(infraction.userId)} \`${infraction.userId}\``,
			`**Moderator** ${userMention(infraction.moderatorId)} \`${infraction.moderatorId}\``,
			`**Reason** ${infraction.reason}`,
		];

		if (linkedCaseText) {
			lines.push(linkedCaseText);
		}

		if (infraction.proofUrl) {
			lines.push(`**Proof** [Link](${infraction.proofUrl})`);
		}

		if (infraction.originalReason) {
			lines.push(`-# *Originally:* ${infraction.originalReason}`);
			if (infraction.editedById) {
				const editTs = infraction.editedAt ? Math.floor(new Date(infraction.editedAt).getTime() / 1000) : null;
				lines.push(`-# *Edited by* <@${infraction.editedById}>${editTs ? ` <t:${editTs}:R>` : ''}`);
			}
		}

		if (infraction.duration) {
			const expireTs = Math.floor((new Date(infraction.createdAt).getTime() + infraction.duration) / 1000);
			const isBan = infraction.type === 'ban' || infraction.type === 'softban';
			const label = isBan ? 'Ban expires' : 'Timeout expires';
			lines.push(`**${label}:** <t:${expireTs}:R> (at <t:${expireTs}:f>)`);
		}

		lines.push(`-# Created <t:${ts}:F>`);

		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId(`mod:case_edit:${infraction.caseId}`)
				.setLabel('Edit Reason')
				.setEmoji('📝')
				.setStyle(ButtonStyle.Secondary),
			new ButtonBuilder()
				.setCustomId(`mod:case_delete:${infraction.caseId}`)
				.setLabel('Delete Case')
				.setEmoji('🗑️')
				.setStyle(ButtonStyle.Danger),
		);
		container.addActionRowComponents(row);

		return interaction.editReply(cv2Reply(container, true));
	}

	public async runEdit(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const caseId = interaction.options.getString('id', true).trim();
		const reason = interaction.options.getString('reason', true).trim();
		const guild = interaction.guild;

		const infraction = await getInfractionByCase(guild.id, caseId);
		if (!infraction) return interaction.editReply(errorReply(`No case found with ID \`${caseId}\`.`));

		await updateInfractionReason(guild.id, caseId, reason, interaction.user.id);

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

	public async runDelete(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const caseId = interaction.options.getString('id', true).trim();
		const guild = interaction.guild;

		const infraction = await getInfractionByCase(guild.id, caseId);
		if (!infraction) {
			return interaction.editReply(errorReply(`Case \`${caseId}\` not found.`));
		}

		await deleteInfraction(guild.id, caseId);

		const targetUser = await interaction.client.users.fetch(infraction.userId).catch(() => null);
		const userLabel = targetUser
			? `${userMention(targetUser.id)} (${targetUser.username} • \`${targetUser.id}\`)`
			: `Unknown User (\`${infraction.userId}\`)`;

		await sendModLog(
			guild,
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

	public async runNoteAdd(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const caseId = interaction.options.getString('id', true).trim();
		const note = interaction.options.getString('note', true).trim();
		const guild = interaction.guild;

		const infraction = await getInfractionByCase(guild.id, caseId);
		if (!infraction) {
			return interaction.editReply(errorReply(`No case found with ID \`${caseId}\`.`));
		}

		const formattedNote = `[Case: ${caseId}] ${note}`;
		await createNote(guild.id, infraction.userId, interaction.user.id, formattedNote);

		return interaction.editReply(successReply(`Successfully added note to Case \`${caseId}\`.`));
	}

	public async runNoteView(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const caseId = interaction.options.getString('id', true).trim();
		const guild = interaction.guild;

		const infraction = await getInfractionByCase(guild.id, caseId);
		if (!infraction) {
			return interaction.editReply(errorReply(`No case found with ID \`${caseId}\`.`));
		}

		const allNotes = await getNotes(guild.id, infraction.userId);
		const casePrefix = `[Case: ${caseId}]`;
		const caseNotes = allNotes.filter((n) => n.content.startsWith(casePrefix));

		const c = makeContainer({
			color: caseNotes.length === 0 ? Colors.Neutral : Colors.Info,
			header: `Case Notes — Case \`${caseId}\``,
		});

		if (caseNotes.length === 0) {
			c.addTextDisplayComponents(new TextDisplayBuilder().setContent('No notes found for this case.'));
		} else {
			c.addSeparatorComponents(separator());
			for (const note of caseNotes) {
				const ts = Math.floor(new Date(note.createdAt).getTime() / 1000);
				const contentWithoutPrefix = note.content.slice(casePrefix.length).trim();
				c.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(
						`**#${note.id}** — <@${note.moderatorId}> • <t:${ts}:R>\n${contentWithoutPrefix}`,
					),
				);
				c.addSeparatorComponents(separator());
			}
		}

		return interaction.editReply({ components: [c], flags: (CV2_FLAG | MessageFlags.Ephemeral) as any });
	}

	public async runProof(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const caseId = interaction.options.getString('id', true).trim();
		const url = interaction.options.getString('url', true).trim();
		const guild = interaction.guild;

		if (!/^https?:\/\/[^\s$.?#].[^\s]*$/i.test(url)) {
			return interaction.editReply(errorReply('Please provide a valid URL starting with http:// or https://.'));
		}

		const infraction = await getInfractionByCase(guild.id, caseId);
		if (!infraction) return interaction.editReply(errorReply(`No case found with ID \`${caseId}\`.`));

		await db
			.update(schema.infractions)
			.set({ proofUrl: url })
			.where(and(eq(schema.infractions.guildId, guild.id), eq(schema.infractions.caseId, caseId)));

		return interaction.editReply(successReply(`Proof URL updated for Case \`${caseId}\`:\n${url}`));
	}

	public async runTimeoutsList(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild())
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		const searchUser = interaction.options.getUser('user');
		const page = interaction.options.getInteger('page') ?? 1;
		const payload = await buildActiveTimeoutsPage(interaction.guild, page - 1, searchUser?.id);
		return interaction.editReply(payload);
	}

	public async runTimeoutsClearAll(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild())
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		const members = await interaction.guild.members.fetch();
		const timedOut = members.filter(
			(m) => !!m.communicationDisabledUntilTimestamp && m.communicationDisabledUntilTimestamp > Date.now(),
		);
		if (timedOut.size === 0) return interaction.editReply(successReply('No members are currently timed out.'));
		let clearedCount = 0;
		for (const member of timedOut.values()) {
			if (member.moderatable) {
				await member.timeout(null, `Cleared all timeouts by ${interaction.user.username}`).catch(() => null);
				clearedCount++;
			}
		}
		if (clearedCount > 0) {
			const { sendModLog } = await import('../../lib/LoggingUtil.js');
			const { logContainer, Colors } = await import('../../lib/components.js');
			await sendModLog(
				interaction.guild,
				logContainer({
					title: 'Server Wide Timeouts Cleared',
					color: Colors.Success,
					fields: [
						{ name: 'Count', value: `${clearedCount} member(s)` },
						{ name: 'Moderator', value: `<@${interaction.user.id}> (${interaction.user.username})` },
					],
					timestamp: true,
				}),
			).catch(() => null);
		}
		return interaction.editReply(successReply(`Successfully removed timeouts from **${clearedCount}** members.`));
	}

	// ── Bans subcommand (originally /bans) ───────────────────────────────────────
	public async runBans(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}

		const search = interaction.options.getString('search')?.toLowerCase();
		const filter = interaction.options.getString('filter') ?? 'all';
		const reasonSearch = interaction.options.getString('reason_search')?.toLowerCase();
		const guild = interaction.guild;

		const bans = await guild.bans.fetch().catch(() => null);
		if (!bans) {
			return interaction.editReply(errorReply('Failed to fetch the ban list.'));
		}

		let filteredBans = Array.from(bans.values());

		if (search) {
			filteredBans = filteredBans.filter((b) => b.user.username.toLowerCase().includes(search));
		}

		if (reasonSearch) {
			filteredBans = filteredBans.filter((b) => b.reason?.toLowerCase().includes(reasonSearch));
		}

		let tempbanMap = new Map<string, typeof schema.tempbans.$inferSelect>();
		if (filter === 'temporary') {
			const activeTempbans = await db.select().from(schema.tempbans).where(eq(schema.tempbans.guildId, guild.id));
			tempbanMap = new Map(activeTempbans.map((tb) => [tb.userId, tb]));
			filteredBans = filteredBans.filter((b) => tempbanMap.has(b.user.id));
		} else {
			const activeTempbans = await db.select().from(schema.tempbans).where(eq(schema.tempbans.guildId, guild.id));
			tempbanMap = new Map(activeTempbans.map((tb) => [tb.userId, tb]));
		}

		const list = filteredBans.slice(0, 20);

		const c = makeContainer({
			color: Colors.Neutral,
			header: `Banned Users (${filteredBans.length})`,
		});

		if (list.length === 0) {
			c.addTextDisplayComponents(new TextDisplayBuilder().setContent('No banned users match the specified criteria.'));
		} else {
			c.addSeparatorComponents(separator());
			for (const ban of list) {
				const tb = tempbanMap.get(ban.user.id);
				const expireTs = tb ? Math.floor(new Date(tb.expiresAt).getTime() / 1000) : null;
				const expireStr = expireTs ? ` • expires <t:${expireTs}:R>` : '';

				c.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(
						`${userMention(ban.user.id)} **${ban.user.username}** (\`${ban.user.id}\`)${expireStr}` +
							(ban.reason ? `\n-# ${ban.reason}` : ''),
					),
				);
			}
			if (filteredBans.length > 20) {
				c.addSeparatorComponents(separator());
				c.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(`-# Showing 20 of ${filteredBans.length} banned users.`),
				);
			}
		}

		return interaction.editReply({ components: [c], flags: (CV2_FLAG | MessageFlags.Ephemeral) as any });
	}

	// ── List subcommand (originally /cases) ───────────────────────────────────────
	public async runList(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}

		const typeFilter = interaction.options.getString('type');
		const userFilter = interaction.options.getUser('user');
		const modFilter = interaction.options.getUser('moderator');

		const payload = await buildCasesPage(interaction.guildId, 0, typeFilter, userFilter?.id, modFilter?.id);
		return interaction.editReply(payload);
	}

	// ── Warnings subcommands (originally /warnings) ──────────────────────────────
	public async runWarningsView(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
			return interaction.editReply(errorReply('You need the **Moderate Members** permission to use this subcommand.'));
		}

		const target = interaction.options.getUser('user', true);
		const guild = interaction.guild;

		const payload = await buildWarningsPage(guild.id, target.id, target.username, 0);
		return interaction.editReply(payload);
	}

	public async runWarningsMine(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const payload = await buildMyWarningsPage(interaction.guildId, interaction.user.id, interaction.user.username, 0);
		return interaction.editReply(payload);
	}

	public async runWarningsExport(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
			return interaction.editReply(errorReply('You need the **Moderate Members** permission to use this subcommand.'));
		}

		const target = interaction.options.getUser('user', true);
		const guild = interaction.guild;

		const infractions = await getInfractions(guild.id, target.id);
		if (infractions.length === 0) {
			return interaction.editReply(successReply(`**${target.username}** has a clean history (0 infractions).`));
		}

		let text = `Infraction History for ${target.username} (ID: ${target.id})\n`;
		text += `Exported from ${guild.name} at ${new Date().toISOString()}\n`;
		text += `Total infractions: ${infractions.length}\n`;
		text += `========================================================================\n\n`;

		for (const inf of infractions) {
			const modUser = await interaction.client.users.fetch(inf.moderatorId).catch(() => null);
			const modName = modUser ? `${modUser.username} (${inf.moderatorId})` : inf.moderatorId;

			text += `[Case ${inf.caseId}] - ${inf.type.toUpperCase()}\n`;
			text += `Date: ${inf.createdAt.toISOString()}\n`;
			text += `Moderator: ${modName}\n`;
			text += `Reason: ${inf.reason}\n`;
			if (inf.duration) {
				const durationLabel = `${Math.floor(inf.duration / 1000)}s`;
				text += `Duration: ${durationLabel}\n`;
			}
			text += `------------------------------------------------------------------------\n\n`;
		}

		const buffer = Buffer.from(text, 'utf-8');
		return interaction.editReply({
			content: `📄 Successfully exported **${infractions.length}** infraction(s) for **${target.username}**.`,
			files: [{ attachment: buffer, name: `infractions-${target.id}.txt` }],
		});
	}

	public async runWarningsClear(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
			return interaction.editReply(errorReply('You need the **Moderate Members** permission to use this subcommand.'));
		}

		const target = interaction.options.getUser('user', true);
		const caseId = interaction.options.getString('case');
		const scope = interaction.options.getString('scope') ?? 'warn';
		const warnOnly = scope === 'warn';
		const guild = interaction.guild;

		if (caseId !== null) {
			const inf = await getInfractionByCase(guild.id, caseId);
			if (!inf) {
				return interaction.editReply(errorReply(`Case \`${caseId}\` not found.`));
			}
			if (inf.userId !== target.id) {
				return interaction.editReply(errorReply(`Case \`${caseId}\` does not belong to **${target.username}**.`));
			}
			await deleteInfraction(guild.id, caseId);

			await sendModLog(
				guild,
				logContainer({
					title: 'Infraction Removed',
					color: Colors.Success,
					fields: [
						{ name: 'Case', value: `\`${caseId}\` (${inf.type})` },
						{ name: 'User', value: `${userMention(target.id)} (${target.username} • \`${target.id}\`)` },
						{ name: 'Moderator', value: `${userMention(interaction.user.id)} (${interaction.user.username})` },
					],
					timestamp: true,
				}),
			).catch(() => null);

			return interaction.editReply(
				successReply(`Case \`${caseId}\` (${inf.type}) removed from **${target.username}**.`),
			);
		}

		const infractions = await getInfractions(guild.id, target.id);
		let filtered = infractions;

		const typeFilter = interaction.options.getString('type');
		if (typeFilter) {
			filtered = filtered.filter((i) => i.type === typeFilter);
		} else if (warnOnly) {
			filtered = filtered.filter((i) => i.type === 'warn');
		}

		const moderatorFilter = interaction.options.getUser('moderator');
		if (moderatorFilter) {
			filtered = filtered.filter((i) => i.moderatorId === moderatorFilter.id);
		}

		const reasonSearch = interaction.options.getString('reason_search');
		if (reasonSearch) {
			const query = reasonSearch.toLowerCase();
			filtered = filtered.filter((i) => i.reason.toLowerCase().includes(query));
		}

		const timeframe = interaction.options.getString('timeframe');
		if (timeframe) {
			const now = Date.now();
			let limitMs = 0;
			if (timeframe === '1h') limitMs = 60 * 60 * 1000;
			else if (timeframe === '24h') limitMs = 24 * 60 * 60 * 1000;
			else if (timeframe === '7d') limitMs = 7 * 24 * 60 * 60 * 1000;
			else if (timeframe === '30d') limitMs = 30 * 24 * 60 * 60 * 1000;

			filtered = filtered.filter((i) => now - new Date(i.createdAt).getTime() <= limitMs);
		}

		const dryRun = interaction.options.getBoolean('dry_run') ?? false;

		if (filtered.length === 0) {
			return interaction.editReply(warningReply(`**${target.username}** has no matching infractions to clear.`));
		}

		if (!dryRun) {
			for (const inf of filtered) {
				await deleteInfraction(guild.id, inf.caseId);
			}

			await sendModLog(
				guild,
				logContainer({
					title: 'Infractions Cleared',
					color: Colors.Success,
					fields: [
						{ name: 'Count', value: `${filtered.length} infraction(s)` },
						{
							name: 'Filters Applied',
							value:
								[
									moderatorFilter ? `Moderator: ${moderatorFilter.username}` : null,
									reasonSearch ? `Reason search: "${reasonSearch}"` : null,
									typeFilter ? `Type: ${typeFilter}` : null,
									timeframe ? `Timeframe: ${timeframe}` : null,
								]
									.filter(Boolean)
									.join(', ') || 'None',
						},
						{ name: 'User', value: `${userMention(target.id)} (${target.username} • \`${target.id}\`)` },
						{ name: 'Moderator', value: `${userMention(interaction.user.id)} (${interaction.user.username})` },
					],
					timestamp: true,
				}),
			).catch(() => null);
		}

		const actionLabel = dryRun ? 'Would clear' : 'Cleared';
		const prefix = dryRun ? '[DRY RUN] ' : '';
		return interaction.editReply(
			successReply(`${prefix}${actionLabel} **${filtered.length}** infraction(s) from **${target.username}**.`),
		);
	}

	public async runCombine(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const targetCaseId = interaction.options.getString('target', true).trim();
		const casesInput = interaction.options.getString('cases', true).trim();
		const guild = interaction.guild;

		const sourceIds = [...new Set(casesInput.match(/[A-Za-z0-9]{7}/g) || [])];
		const filteredSourceIds = sourceIds.filter((id) => id !== targetCaseId);

		if (filteredSourceIds.length === 0) {
			return interaction.editReply(
				errorReply(
					'No valid source case IDs found to merge. Make sure they are 7-character alphanumeric codes and distinct from the target case ID.',
				),
			);
		}

		const targetCase = await getInfractionByCase(guild.id, targetCaseId);
		if (!targetCase) {
			return interaction.editReply(errorReply(`Target case \`${targetCaseId}\` not found.`));
		}

		const sourceCases = [];
		for (const id of filteredSourceIds) {
			const inf = await getInfractionByCase(guild.id, id);
			if (!inf) {
				return interaction.editReply(errorReply(`Source case \`${id}\` not found.`));
			}
			if (inf.userId !== targetCase.userId) {
				return interaction.editReply(
					errorReply(
						`Case \`${id}\` targets a different user (<@${inf.userId}>) than target case \`${targetCaseId}\` (<@${targetCase.userId}>).`,
					),
				);
			}
			sourceCases.push(inf);
		}

		// Update notes prefix
		const allNotes = await getNotes(guild.id, targetCase.userId);
		for (const note of allNotes) {
			for (const sourceCase of sourceCases) {
				const oldPrefix = `[Case: ${sourceCase.caseId}]`;
				if (note.content.startsWith(oldPrefix)) {
					const newContent = `[Case: ${targetCase.caseId}]${note.content.slice(oldPrefix.length)}`;
					await db.update(schema.modNotes).set({ content: newContent }).where(eq(schema.modNotes.id, note.id));
				}
			}
		}

		// Re-target tempbans
		for (const sourceCase of sourceCases) {
			await db
				.update(schema.tempbans)
				.set({ caseId: targetCase.caseId })
				.where(eq(schema.tempbans.caseId, sourceCase.caseId));
		}

		// Retain linkedCaseId if targetCase doesn't have one but a source case does
		let newLinkedCaseId = targetCase.linkedCaseId;
		if (!newLinkedCaseId) {
			for (const sourceCase of sourceCases) {
				if (sourceCase.linkedCaseId) {
					newLinkedCaseId = sourceCase.linkedCaseId;
					break;
				}
			}
		}

		// Re-target infractions linking to the source cases to point to targetCase instead
		for (const sourceCase of sourceCases) {
			await db
				.update(schema.infractions)
				.set({ linkedCaseId: targetCase.caseId })
				.where(and(eq(schema.infractions.guildId, guild.id), eq(schema.infractions.linkedCaseId, sourceCase.caseId)));
		}

		// Combine reasons
		let mergedReason = targetCase.reason;
		for (const sourceCase of sourceCases) {
			mergedReason += `\n[Merged Case ${sourceCase.caseId} (${sourceCase.type.toUpperCase()}): ${sourceCase.reason}]`;
		}

		// Update target case reason & details
		await updateInfractionReason(guild.id, targetCase.caseId, mergedReason, interaction.user.id);
		if (newLinkedCaseId !== targetCase.linkedCaseId) {
			await db
				.update(schema.infractions)
				.set({ linkedCaseId: newLinkedCaseId })
				.where(and(eq(schema.infractions.guildId, guild.id), eq(schema.infractions.caseId, targetCase.caseId)));
		}

		// Delete source cases
		for (const sourceCase of sourceCases) {
			await deleteInfraction(guild.id, sourceCase.caseId);
		}

		// Dispatch mod log
		const targetUser = await interaction.client.users.fetch(targetCase.userId).catch(() => null);
		const userLabel = targetUser
			? `${userMention(targetUser.id)} (${targetUser.username} • \`${targetUser.id}\`)`
			: `Unknown User (\`${targetCase.userId}\`)`;

		await sendModLog(
			guild,
			logContainer({
				title: 'Cases Merged',
				color: Colors.Success,
				fields: [
					{ name: 'Target Case', value: `\`${targetCase.caseId}\` (${targetCase.type})` },
					{ name: 'Merged Cases', value: filteredSourceIds.map((id) => `\`${id}\``).join(', ') },
					{ name: 'User', value: userLabel },
					{ name: 'Moderator', value: `${userMention(interaction.user.id)} (${interaction.user.username})` },
					{ name: 'New Reason', value: mergedReason },
				],
				timestamp: true,
			}),
		).catch(() => null);

		return interaction.editReply(
			successReply(
				`Successfully merged case(s) ${filteredSourceIds.map((id) => `\`${id}\``).join(', ')} into target case \`${targetCase.caseId}\`.`,
			),
		);
	}

	// ── /case modstats view ────────────────────────────────────────────────────
	public async runModStatsView(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}

		const targetMod = interaction.options.getUser('moderator');
		const timeframe = interaction.options.getString('timeframe') ?? 'all';

		let limitDate: Date | null = null;
		if (timeframe === '7d') {
			limitDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
		} else if (timeframe === '30d') {
			limitDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
		}

		const tfLabel = timeframe === '7d' ? 'Past 7 days' : timeframe === '30d' ? 'Past 30 days' : 'Lifetime';

		if (targetMod) {
			const conditions = [
				eq(schema.infractions.guildId, interaction.guildId),
				eq(schema.infractions.moderatorId, targetMod.id),
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

			const c = makeContainer({ color: Colors.Info, header: `Mod Stats (${tfLabel}) — ${targetMod.username}` });
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
					new TextDisplayBuilder().setContent(`${userMention(targetMod.id)}\n\n${lines}\n\n**Total:** ${rows.length}`),
				);
			}

			return interaction.editReply(cv2Reply(c, true));
		}

		const conditions = [eq(schema.infractions.guildId, interaction.guildId)];
		if (limitDate) {
			conditions.push(gte(schema.infractions.createdAt, limitDate));
		}

		const allRows = await db
			.select()
			.from(schema.infractions)
			.where(and(...conditions));

		const modCounts = new Map<string, number>();
		for (const row of allRows) {
			modCounts.set(row.moderatorId, (modCounts.get(row.moderatorId) ?? 0) + 1);
		}

		const sorted = [...modCounts.entries()].sort(([, a], [, b]) => b - a).slice(0, 15);

		const c = makeContainer({ color: Colors.Info, header: `Mod Action Leaderboard (${tfLabel})` });

		if (sorted.length === 0) {
			c.addTextDisplayComponents(
				new TextDisplayBuilder().setContent('No moderation actions recorded in this server for this timeframe.'),
			);
			return interaction.editReply(cv2Reply(c, true));
		}

		c.addSeparatorComponents(separator());
		const lines = sorted
			.map(([modId, n], i) => `**${i + 1}.** ${userMention(modId)} — **${n}** action${n === 1 ? '' : 's'}`)
			.join('\n');
		c.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines));

		const selectMenu = new StringSelectMenuBuilder()
			.setCustomId(`mod:stats_inspect:${timeframe}`)
			.setPlaceholder('Select a moderator to inspect their breakdown...');

		const options: StringSelectMenuOptionBuilder[] = [];
		for (const [modId] of sorted) {
			const member = interaction.guild.members.cache.get(modId);
			const label = member ? member.user.username : `User ${modId}`;
			options.push(
				new StringSelectMenuOptionBuilder()
					.setLabel(label.slice(0, 50))
					.setDescription(`ID: ${modId}`)
					.setValue(modId)
					.setEmoji('📊'),
			);
		}
		selectMenu.addOptions(options);

		const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
		c.addActionRowComponents(row);

		return interaction.editReply(cv2Reply(c, true));
	}

	// ── /case modstats export ──────────────────────────────────────────────────
	public async runModStatsExport(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}

		const timeframe = interaction.options.getString('timeframe') ?? 'all';

		let limitDate: Date | null = null;
		if (timeframe === '7d') {
			limitDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
		} else if (timeframe === '30d') {
			limitDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
		}

		const conditions = [eq(schema.infractions.guildId, interaction.guildId)];
		if (limitDate) {
			conditions.push(gte(schema.infractions.createdAt, limitDate));
		}

		const allRows = await db
			.select()
			.from(schema.infractions)
			.where(and(...conditions));

		if (allRows.length === 0) {
			return interaction.editReply(errorReply('No moderation actions found to export in this timeframe.'));
		}

		const csvRows = ['Case ID,Type,Target ID,Moderator ID,Reason,Created At'];
		for (const inf of allRows) {
			const reason = `"${inf.reason.replace(/"/g, '""')}"`;
			const createdAt = new Date(inf.createdAt).toISOString();
			csvRows.push(`${inf.caseId},${inf.type},${inf.userId},${inf.moderatorId},${reason},${createdAt}`);
		}

		const file = new AttachmentBuilder(Buffer.from(csvRows.join('\n'), 'utf-8'), {
			name: `mod_stats_${timeframe}_export.csv`,
		});

		return interaction.editReply({
			content: `Here is the CSV export of moderation activity for the timeframe **${timeframe}**.`,
			files: [file],
		});
	}
}
