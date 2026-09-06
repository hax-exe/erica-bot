import { ApplyOptions } from '@sapphire/decorators';
import type { Command } from '@sapphire/framework';
import { Subcommand } from '@sapphire/plugin-subcommands';
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChannelType,
	ContainerBuilder,
	MessageFlags,
	ModalBuilder,
	PermissionFlagsBits,
	Role,
	SeparatorBuilder,
	SeparatorSpacingSize,
	TextDisplayBuilder,
	TextInputBuilder,
	TextInputStyle,
	userMention,
} from 'discord.js';
import { and, eq } from 'drizzle-orm';
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
import { checkHierarchy, createNote, deleteNote, handleReasonAutocomplete } from '../../lib/ModerationUtil.js';
import { humanDuration, parseDuration } from '../../lib/parseDuration.js';
import { buildNotesPage } from '../../listeners/paginationInteractions.js';

export const ANNOUNCE_COLOR_PRESETS: Record<string, number> = {
	blue: 0x5865f2,
	green: 0x57f287,
	yellow: 0xfee75c,
	red: 0xed4245,
	purple: 0x9b59b6,
	teal: 0x1abc9c,
	white: 0xffffff,
};

// Presets for timeout durations
const _TIMEOUT_DURATION_PRESETS: Record<string, number> = {
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

function parseSlowmodeDuration(input: string): number | null {
	const clean = input.trim().toLowerCase();
	if (clean === 'off' || clean === 'disable') return 0;
	if (/^\d+$/.test(clean)) {
		return parseInt(clean, 10);
	}
	const ms = parseDuration(clean);
	return ms !== null ? Math.floor(ms / 1000) : null;
}

async function lockChannel(ch: any, rolesEveryone: any, auditReason: string) {
	const isVoice = ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice;
	const overwrites = isVoice ? { Connect: false } : { SendMessages: false };
	await ch.permissionOverwrites.edit(rolesEveryone, overwrites, { reason: auditReason });
}

async function unlockChannel(ch: any, rolesEveryone: any, auditReason: string) {
	const isVoice = ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice;
	const overwrites = isVoice ? { Connect: null } : { SendMessages: null };
	await ch.permissionOverwrites.edit(rolesEveryone, overwrites, { reason: auditReason });
}

const DEFAULT_HOIST_PATTERN = '[\\s!"#$%&\'()*+,\\-./:;<=>?@[\\\\\\]^_`{|}~]';

function escapeRegex(str: string): string {
	return str.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

function getHoistRegex(exclude?: string | null): RegExp {
	let pattern = DEFAULT_HOIST_PATTERN;
	if (exclude) {
		for (const char of exclude) {
			pattern = pattern.replace(new RegExp(escapeRegex(char), 'g'), '');
		}
	}
	return new RegExp(`^${pattern}`);
}

@ApplyOptions<Subcommand.Options>({
	name: 'mod',
	description: 'Perform moderation actions on members or channels.',
	preconditions: ['Moderation'],
	subcommands: [
		{ name: 'lock', chatInputRun: 'chatInputLock' },
		{ name: 'unlock', chatInputRun: 'chatInputUnlock' },
		{ name: 'slowmode', chatInputRun: 'chatInputSlowmode' },
		{
			name: 'mass',
			type: 'group',
			entries: [
				{ name: 'ban', chatInputRun: 'chatInputMassBan' },
				{ name: 'kick', chatInputRun: 'chatInputMassKick' },
				{ name: 'timeout', chatInputRun: 'chatInputMassTimeout' },
				{ name: 'unban', chatInputRun: 'chatInputMassUnban' },
				{ name: 'untimeout', chatInputRun: 'chatInputMassUntimeout' },
				{ name: 'warn', chatInputRun: 'chatInputMassWarn' },
			],
		},
		{ name: 'warndecay', chatInputRun: 'chatInputWarnDecay' },
		{ name: 'proofrequired', chatInputRun: 'chatInputProofRequired' },
		{ name: 'requirereview', chatInputRun: 'chatInputRequireReview' },
		{
			name: 'presets',
			type: 'group',
			entries: [
				{ name: 'add', chatInputRun: 'chatInputPresetsAdd' },
				{ name: 'remove', chatInputRun: 'chatInputPresetsRemove' },
				{ name: 'list', chatInputRun: 'chatInputPresetsList' },
			],
		},
		{
			name: 'autorole',
			type: 'group',
			entries: [
				{ name: 'add', chatInputRun: 'chatInputAutoRoleAdd' },
				{ name: 'remove', chatInputRun: 'chatInputAutoRoleRemove' },
				{ name: 'list', chatInputRun: 'chatInputAutoRoleList' },
			],
		},
		{
			name: 'escalation',
			type: 'group',
			entries: [
				{ name: 'add', chatInputRun: 'chatInputEscalationAdd' },
				{ name: 'remove', chatInputRun: 'chatInputEscalationRemove' },
				{ name: 'view', chatInputRun: 'chatInputEscalationView' },
				{ name: 'test', chatInputRun: 'chatInputEscalationTest' },
			],
		},
		{
			name: 'note',
			type: 'group',
			entries: [
				{ name: 'add', chatInputRun: 'chatInputNoteAdd' },
				{ name: 'list', chatInputRun: 'chatInputNoteList' },
				{ name: 'delete', chatInputRun: 'chatInputNoteDelete' },
				{ name: 'edit', chatInputRun: 'chatInputNoteEdit' },
				{ name: 'clear', chatInputRun: 'chatInputNoteClear' },
			],
		},
		{ name: 'nick', chatInputRun: 'chatInputNick' },
		{
			name: 'role',
			type: 'group',
			entries: [
				{ name: 'add', chatInputRun: 'chatInputRoleAdd' },
				{ name: 'remove', chatInputRun: 'chatInputRoleRemove' },
			],
		},
		{
			name: 'timerole',
			type: 'group',
			entries: [
				{ name: 'give', chatInputRun: 'chatInputTimeroleGive' },
				{ name: 'revoke', chatInputRun: 'chatInputTimeroleRevoke' },
				{ name: 'list', chatInputRun: 'chatInputTimeroleList' },
			],
		},
		{
			name: 'dehoist',
			type: 'group',
			entries: [
				{ name: 'user', chatInputRun: 'chatInputDehoistUser' },
				{ name: 'list', chatInputRun: 'chatInputDehoistList' },
				{ name: 'clean', chatInputRun: 'chatInputDehoistClean' },
			],
		},
		{ name: 'announce', chatInputRun: 'chatInputAnnounce' },
		{ name: 'honeypot', chatInputRun: 'chatInputHoneypot' },
	],
})
export class ModCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('mod')
				.setDescription('Perform moderation actions on members or channels.')

				// ── lock ───────────────────────────────────────────────────────────────
				.addSubcommand((sub) =>
					sub
						.setName('lock')
						.setDescription('Lock channels to prevent everyone from sending messages or connecting.')
						.addChannelOption((o) =>
							o
								.setName('channel')
								.setDescription('Channel to lock (defaults to current channel).')
								.addChannelTypes(
									ChannelType.GuildText,
									ChannelType.GuildAnnouncement,
									ChannelType.GuildVoice,
									ChannelType.GuildStageVoice,
								)
								.setRequired(false),
						)
						.addChannelOption((o) =>
							o
								.setName('category')
								.setDescription('Category to lock all channels in.')
								.addChannelTypes(ChannelType.GuildCategory)
								.setRequired(false),
						)
						.addStringOption((o) =>
							o
								.setName('duration')
								.setDescription('Automatically unlock after this time (e.g. 10m, 1h).')
								.setRequired(false),
						)
						.addBooleanOption((o) =>
							o
								.setName('kick_current')
								.setDescription('Kick everyone currently in the voice channel (voice only).')
								.setRequired(false),
						)
						.addStringOption((o) => o.setName('reason').setDescription('Reason for locking.').setRequired(false))
						.addBooleanOption((o) =>
							o.setName('all').setDescription('Lock all text and voice channels in the server.').setRequired(false),
						),
				)
				// ── unlock ─────────────────────────────────────────────────────────────
				.addSubcommand((sub) =>
					sub
						.setName('unlock')
						.setDescription('Restore permissions for everyone in a locked channel.')
						.addChannelOption((o) =>
							o
								.setName('channel')
								.setDescription('Channel to unlock (defaults to current channel).')
								.addChannelTypes(
									ChannelType.GuildText,
									ChannelType.GuildAnnouncement,
									ChannelType.GuildVoice,
									ChannelType.GuildStageVoice,
								)
								.setRequired(false),
						)
						.addChannelOption((o) =>
							o
								.setName('category')
								.setDescription('Category to unlock all channels in.')
								.addChannelTypes(ChannelType.GuildCategory)
								.setRequired(false),
						)
						.addStringOption((o) => o.setName('reason').setDescription('Reason for unlocking.').setRequired(false))
						.addBooleanOption((o) =>
							o.setName('all').setDescription('Unlock all text and voice channels in the server.').setRequired(false),
						),
				)
				// ── slowmode ───────────────────────────────────────────────────────────
				.addSubcommand((sub) =>
					sub
						.setName('slowmode')
						.setDescription('Set or clear the slowmode delay for channels.')
						.addStringOption((o) =>
							o
								.setName('duration')
								.setDescription('Slowmode delay (e.g., 5s, 10s, 1m, 5m, 0 to disable).')
								.setRequired(true)
								.setAutocomplete(true),
						)
						.addChannelOption((o) =>
							o
								.setName('channel')
								.setDescription('Channel to apply slowmode to (defaults to current channel).')
								.addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
								.setRequired(false),
						)
						.addBooleanOption((o) =>
							o.setName('all').setDescription('Apply to all text channels in the server.').setRequired(false),
						)
						.addStringOption((o) =>
							o
								.setName('reset_after')
								.setDescription('Automatically reset slowmode after this time (e.g. 10m, 1h).')
								.setRequired(false),
						),
				)
				.addSubcommandGroup((group) =>
					group
						.setName('mass')
						.setDescription('Mass moderation actions.')
						// ban
						.addSubcommand((sub) =>
							sub
								.setName('ban')
								.setDescription('Ban multiple users at once by their IDs.')
								.addStringOption((o) =>
									o.setName('users').setDescription('Space or comma separated list of User IDs.').setRequired(true),
								)
								.addStringOption((o) =>
									o.setName('reason').setDescription('Reason for the mass ban.').setRequired(false),
								)
								.addIntegerOption((o) =>
									o
										.setName('delete_days')
										.setDescription('Number of days of messages to delete (0-7).')
										.setMinValue(0)
										.setMaxValue(7)
										.setRequired(false),
								),
						)
						// kick
						.addSubcommand((sub) =>
							sub
								.setName('kick')
								.setDescription('Kick multiple users at once by their IDs.')
								.addStringOption((o) =>
									o.setName('users').setDescription('Space or comma separated list of User IDs.').setRequired(true),
								)
								.addStringOption((o) =>
									o.setName('reason').setDescription('Reason for the mass kick.').setRequired(false),
								),
						)
						// timeout
						.addSubcommand((sub) =>
							sub
								.setName('timeout')
								.setDescription('Timeout multiple users at once by their IDs.')
								.addStringOption((o) =>
									o.setName('users').setDescription('Space or comma separated list of User IDs.').setRequired(true),
								)
								.addStringOption((o) =>
									o
										.setName('duration')
										.setDescription('Timeout duration (e.g. 10m, 1h, 1d). Max 28 days.')
										.setRequired(true),
								)
								.addStringOption((o) =>
									o.setName('reason').setDescription('Reason for the mass timeout.').setRequired(false),
								),
						)
						// unban
						.addSubcommand((sub) =>
							sub
								.setName('unban')
								.setDescription('Unban multiple users at once by their IDs.')
								.addStringOption((o) =>
									o.setName('users').setDescription('Space or comma separated list of User IDs.').setRequired(true),
								)
								.addStringOption((o) =>
									o.setName('reason').setDescription('Reason for the mass unban.').setRequired(false),
								),
						)
						// untimeout
						.addSubcommand((sub) =>
							sub
								.setName('untimeout')
								.setDescription('Remove timeout from multiple users at once by their IDs.')
								.addStringOption((o) =>
									o.setName('users').setDescription('Space or comma separated list of User IDs.').setRequired(true),
								)
								.addStringOption((o) =>
									o.setName('reason').setDescription('Reason for the mass untimeout.').setRequired(false),
								),
						)
						// warn
						.addSubcommand((sub) =>
							sub
								.setName('warn')
								.setDescription('Warn multiple users at once by their IDs.')
								.addStringOption((o) =>
									o.setName('users').setDescription('Space or comma separated list of User IDs.').setRequired(true),
								)
								.addStringOption((o) =>
									o.setName('reason').setDescription('Reason for the mass warning.').setRequired(false),
								),
						),
				)
				// ── warndecay ──────────────────────────────────────────────────────────
				.addSubcommand((sub) =>
					sub
						.setName('warndecay')
						.setDescription('Set or clear the warning decay duration for this server.')
						.addIntegerOption((o) =>
							o
								.setName('days')
								.setDescription('Number of days before warnings expire (omit to clear).')
								.setMinValue(1)
								.setMaxValue(365)
								.setRequired(false),
						),
				)
				// ── proofrequired ──────────────────────────────────────────────────────
				.addSubcommand((sub) =>
					sub
						.setName('proofrequired')
						.setDescription('Toggle whether moderators must attach proof for punishments.')
						.addBooleanOption((o) =>
							o.setName('enabled').setDescription('Whether proof is required (true/false).').setRequired(true),
						),
				)
				// ── requirereview ──────────────────────────────────────────────────────
				.addSubcommand((sub) =>
					sub
						.setName('requirereview')
						.setDescription('Toggle whether moderators must review a punishment.')
						.addBooleanOption((o) =>
							o.setName('enabled').setDescription('Whether review is required (true/false).').setRequired(true),
						),
				)
				// ── presets ────────────────────────────────────────────────────────────
				.addSubcommandGroup((group) =>
					group
						.setName('presets')
						.setDescription('Configure moderation reason presets for the server.')
						.addSubcommand((sub) =>
							sub
								.setName('add')
								.setDescription('Add a new moderation reason preset.')
								.addStringOption((o) =>
									o.setName('reason').setDescription('The preset reason to add.').setRequired(true),
								),
						)
						.addSubcommand((sub) =>
							sub
								.setName('remove')
								.setDescription('Remove a moderation reason preset.')
								.addIntegerOption((o) =>
									o
										.setName('id')
										.setDescription('The ID of the preset to remove.')
										.setRequired(true)
										.setAutocomplete(true),
								),
						)
						.addSubcommand((sub) => sub.setName('list').setDescription('List all moderation reason presets.')),
				)
				// ── autorole ───────────────────────────────────────────────────────────
				.addSubcommandGroup((group) =>
					group
						.setName('autorole')
						.setDescription('Manage join auto-roles.')
						.addSubcommand((sub) =>
							sub
								.setName('add')
								.setDescription('Add a role.')
								.addRoleOption((o) => o.setName('role').setDescription('Role.').setRequired(true)),
						)
						.addSubcommand((sub) =>
							sub
								.setName('remove')
								.setDescription('Remove a role.')
								.addRoleOption((o) => o.setName('role').setDescription('Role.').setRequired(true)),
						)
						.addSubcommand((sub) => sub.setName('list').setDescription('List roles.')),
				)
				// ── escalation ─────────────────────────────────────────────────────────
				.addSubcommandGroup((group) =>
					group
						.setName('escalation')
						.setDescription('Configure warn escalation.')
						.addSubcommand((sub) =>
							sub
								.setName('add')
								.setDescription('Add escalation rule.')
								.addIntegerOption((o) =>
									o
										.setName('threshold')
										.setDescription('Warning threshold.')
										.setMinValue(1)
										.setMaxValue(50)
										.setRequired(true),
								)
								.addStringOption((o) =>
									o
										.setName('action')
										.setDescription('Action.')
										.setRequired(true)
										.addChoices(
											{ name: 'Timeout', value: 'timeout' },
											{ name: 'Kick', value: 'kick' },
											{ name: 'Ban', value: 'ban' },
										),
								)
								.addStringOption((o) => o.setName('duration').setDescription('Timeout duration.').setRequired(false)),
						)
						.addSubcommand((sub) =>
							sub
								.setName('remove')
								.setDescription('Remove rule.')
								.addIntegerOption((o) => o.setName('threshold').setDescription('Threshold.').setRequired(true)),
						)
						.addSubcommand((sub) => sub.setName('view').setDescription('List rules.'))
						.addSubcommand((sub) =>
							sub
								.setName('test')
								.setDescription('Preview escalation.')
								.addUserOption((o) => o.setName('user').setDescription('User.').setRequired(true)),
						),
				)
				// ── note ───────────────────────────────────────────────────────────────
				.addSubcommandGroup((group) =>
					group
						.setName('note')
						.setDescription('Manage moderator notes for a member.')
						.addSubcommand((sub) =>
							sub
								.setName('add')
								.setDescription('Add a note to a member.')
								.addUserOption((o) =>
									o.setName('user').setDescription('The member to add a note for.').setRequired(true),
								)
								.addStringOption((o) =>
									o.setName('note').setDescription('The note content.').setRequired(true).setMaxLength(500),
								),
						)
						.addSubcommand((sub) =>
							sub
								.setName('list')
								.setDescription('List all notes for a member.')
								.addUserOption((o) =>
									o.setName('user').setDescription('The member to view notes for.').setRequired(true),
								)
								.addIntegerOption((o) =>
									o
										.setName('page')
										.setDescription('Page number to view (1-indexed).')
										.setRequired(false)
										.setMinValue(1),
								),
						)
						.addSubcommand((sub) =>
							sub
								.setName('delete')
								.setDescription('Delete a note by its ID.')
								.addIntegerOption((o) =>
									o.setName('id').setDescription('The note ID to delete.').setRequired(true).setMinValue(1),
								),
						)
						.addSubcommand((sub) =>
							sub
								.setName('edit')
								.setDescription('Edit a moderator note by its ID.')
								.addIntegerOption((o) =>
									o.setName('id').setDescription('The note ID to edit.').setRequired(true).setMinValue(1),
								)
								.addStringOption((o) =>
									o.setName('note').setDescription('New note content.').setRequired(true).setMaxLength(500),
								),
						)
						.addSubcommand((sub) =>
							sub
								.setName('clear')
								.setDescription('Clear all notes for a member.')
								.addUserOption((o) =>
									o.setName('user').setDescription('The member to clear notes for.').setRequired(true),
								),
						),
				)
				// ── nick ───────────────────────────────────────────────────────────────
				.addSubcommand((sub) =>
					sub
						.setName('nick')
						.setDescription("Set or clear a member's nickname.")
						.addUserOption((o) => o.setName('user').setDescription('The member to update.').setRequired(true))
						.addStringOption((o) =>
							o.setName('nickname').setDescription('New nickname (omit to clear).').setRequired(false).setMaxLength(32),
						),
				)
				// ── role ───────────────────────────────────────────────────────────────
				.addSubcommandGroup((group) =>
					group
						.setName('role')
						.setDescription('Add or remove a role from a member.')
						.addSubcommand((sub) =>
							sub
								.setName('add')
								.setDescription('Give a role to a member.')
								.addUserOption((o) => o.setName('user').setDescription('The member to update.').setRequired(true))
								.addRoleOption((o) => o.setName('role').setDescription('The role to assign.').setRequired(true))
								.addStringOption((o) =>
									o.setName('reason').setDescription('Reason for the role change.').setRequired(false),
								),
						)
						.addSubcommand((sub) =>
							sub
								.setName('remove')
								.setDescription('Take a role from a member.')
								.addUserOption((o) => o.setName('user').setDescription('The member to update.').setRequired(true))
								.addRoleOption((o) => o.setName('role').setDescription('The role to remove.').setRequired(true))
								.addStringOption((o) =>
									o.setName('reason').setDescription('Reason for the role change.').setRequired(false),
								),
						),
				)
				// ── timerole ───────────────────────────────────────────────────────────
				.addSubcommandGroup((group) =>
					group
						.setName('timerole')
						.setDescription('Grant a role temporarily — it is removed automatically after the duration.')
						.addSubcommand((sub) =>
							sub
								.setName('give')
								.setDescription('Give a user a role for a set duration.')
								.addUserOption((o) => o.setName('user').setDescription('User to give the role to.').setRequired(true))
								.addRoleOption((o) => o.setName('role').setDescription('Role to assign.').setRequired(true))
								.addStringOption((o) =>
									o
										.setName('duration')
										.setDescription('How long to grant the role (e.g. 1h, 7d, 30m).')
										.setRequired(true),
								),
						)
						.addSubcommand((sub) =>
							sub
								.setName('revoke')
								.setDescription('Revoke a timed role before it expires.')
								.addIntegerOption((o) =>
									o.setName('id').setDescription('Timed role ID from /timerole list.').setRequired(true),
								),
						)
						.addSubcommand((sub) =>
							sub
								.setName('list')
								.setDescription('List active timed roles in this server.')
								.addUserOption((o) =>
									o.setName('user').setDescription('Filter by user (optional).').setRequired(false),
								),
						),
				)
				// ── dehoist ────────────────────────────────────────────────────────────
				.addSubcommandGroup((group) =>
					group
						.setName('dehoist')
						.setDescription('Manage and clean hoisted nicknames.')
						.addSubcommand((sub) =>
							sub
								.setName('user')
								.setDescription('Dehoist a specific member.')
								.addUserOption((o) => o.setName('user').setDescription('The member to dehoist.').setRequired(true)),
						)
						.addSubcommand((sub) =>
							sub
								.setName('list')
								.setDescription('List all currently hoisted members.')
								.addStringOption((o) =>
									o
										.setName('exclude')
										.setDescription('Characters to exclude from the hoisting filter.')
										.setRequired(false),
								),
						)
						.addSubcommand((sub) =>
							sub
								.setName('clean')
								.setDescription('Bulk dehoist all hoisted members.')
								.addStringOption((o) =>
									o
										.setName('exclude')
										.setDescription('Characters to exclude from the hoisting filter.')
										.setRequired(false),
								),
						),
				)
				// ── announce ───────────────────────────────────────────────────────────
				.addSubcommand((sub) =>
					sub
						.setName('announce')
						.setDescription('Send a formatted announcement to a channel.')
						.addChannelOption((o) =>
							o
								.setName('channel')
								.setDescription('Channel to send the announcement in.')
								.addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
								.setRequired(true),
						)
						.addMentionableOption((o) =>
							o
								.setName('ping')
								.setDescription('Optional role or user to ping alongside the announcement.')
								.setRequired(false),
						)
						.addStringOption((o) =>
							o
								.setName('color')
								.setDescription('Accent color for the container (default: blue).')
								.setRequired(false)
								.addChoices(
									{ name: 'Blue', value: 'blue' },
									{ name: 'Green', value: 'green' },
									{ name: 'Yellow', value: 'yellow' },
									{ name: 'Red', value: 'red' },
									{ name: 'Purple', value: 'purple' },
									{ name: 'Teal', value: 'teal' },
									{ name: 'White', value: 'white' },
								),
						),
				)
				// ── honeypot ───────────────────────────────────────────────────────────
				.addSubcommand((sub) =>
					sub
						.setName('honeypot')
						.setDescription('Toggle honeypot status for a channel.')
						.addBooleanOption((o) =>
							o.setName('enabled').setDescription('Whether this channel should be a honeypot.').setRequired(true),
						)
						.addStringOption((o) =>
							o
								.setName('punishment')
								.setDescription('The punishment for messaging in the honeypot (default: ban).')
								.setRequired(false)
								.addChoices(
									{ name: 'Warn ⚠️', value: 'warn' },
									{ name: 'Timeout (24h) ⏱️', value: 'timeout' },
									{ name: 'Kick 👢', value: 'kick' },
									{ name: 'Ban 🔨', value: 'ban' },
								),
						)
						.addStringOption((o) =>
							o
								.setName('duration')
								.setDescription('Optional temp ban or timeout duration (e.g. 24h, 7d).')
								.setRequired(false),
						)
						.addChannelOption((o) =>
							o
								.setName('channel')
								.setDescription('Channel to target (defaults to current channel).')
								.addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
								.setRequired(false),
						),
				),
		);
	}

	public override async autocompleteRun(interaction: Command.AutocompleteInteraction) {
		const group = interaction.options.getSubcommandGroup(false);
		const subcommand = interaction.options.getSubcommand(true);
		if (group === 'presets' && subcommand === 'remove') {
			const { PresetsHandler } = await import('../../lib/config/handlers/presets.js');
			return new PresetsHandler().autocompleteRun(interaction);
		}

		if (subcommand === 'slowmode') {
			const focused = interaction.options.getFocused().toLowerCase();
			const presets = [
				{ name: 'Off / Disable', value: '0s' },
				{ name: '5 seconds', value: '5s' },
				{ name: '10 seconds', value: '10s' },
				{ name: '15 seconds', value: '15s' },
				{ name: '30 seconds', value: '30s' },
				{ name: '1 minute', value: '1m' },
				{ name: '2 minutes', value: '2m' },
				{ name: '5 minutes', value: '5m' },
				{ name: '10 minutes', value: '10m' },
				{ name: '30 minutes', value: '30m' },
				{ name: '1 hour', value: '1h' },
				{ name: '2 hours', value: '2h' },
				{ name: '6 hours', value: '6h' },
			];

			const filtered = presets.filter(
				(p) => p.name.toLowerCase().includes(focused) || p.value.toLowerCase().includes(focused),
			);
			return interaction.respond(filtered.slice(0, 25));
		} else {
			return handleReasonAutocomplete(interaction);
		}
	}

	// ── /mod lock ──────────────────────────────────────────────────────────────
	public async chatInputLock(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}

		if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
			return interaction.editReply(errorReply('You do not have permission to manage channels.'));
		}

		const reason = interaction.options.getString('reason') ?? 'No reason provided';
		const lockAll = interaction.options.getBoolean('all') ?? false;
		const category = interaction.options.getChannel('category');
		const durationStr = interaction.options.getString('duration');
		const kickCurrent = interaction.options.getBoolean('kick_current') ?? false;
		const guild = interaction.guild;
		const auditReason = `[${interaction.user.username}] Lock — ${reason}`;

		let durationMs: number | null = null;
		if (durationStr) {
			durationMs = parseDuration(durationStr);
			if (!durationMs) {
				return interaction.editReply(errorReply('Invalid duration format. Use formats like `10m`, `2h`, `1d`.'));
			}
		}

		const channelsToLock: any[] = [];

		if (lockAll) {
			const allChs = guild.channels.cache.filter(
				(c) =>
					c.type === ChannelType.GuildText ||
					c.type === ChannelType.GuildAnnouncement ||
					c.type === ChannelType.GuildVoice ||
					c.type === ChannelType.GuildStageVoice,
			);
			channelsToLock.push(...allChs.values());
		} else if (category) {
			const catChs = guild.channels.cache.filter((c) => c.parentId === category.id);
			channelsToLock.push(...catChs.values());
		} else {
			const channel = interaction.options.getChannel('channel') ?? interaction.channel;
			if (channel) {
				channelsToLock.push(channel);
			}
		}

		if (channelsToLock.length === 0) {
			return interaction.editReply(errorReply('No eligible channels found to lock.'));
		}

		let lockedCount = 0;
		for (const ch of channelsToLock) {
			if (!('permissionOverwrites' in ch)) continue;
			try {
				await lockChannel(ch, guild.roles.everyone, auditReason);
				lockedCount++;

				if (kickCurrent && (ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice)) {
					const voiceMembers = Array.from(ch.members.values()) as any[];
					for (const m of voiceMembers) {
						await m.voice.disconnect(auditReason).catch(() => null);
					}
				}

				if (ch.isTextBased()) {
					const notice = makeContainer({ color: Colors.Warning });
					let noticeText = `🔒 This channel has been locked by ${interaction.user.username}.\n-# Reason: ${reason}`;
					if (durationMs) {
						noticeText += `\n⏱️ Automatically unlocks <t:${Math.floor((Date.now() + durationMs) / 1000)}:R>.`;
					}
					notice.addTextDisplayComponents(new TextDisplayBuilder().setContent(noticeText));
					await ch.send({ components: [notice], flags: CV2_FLAG }).catch(() => null);
				}

				if (durationMs) {
					setTimeout(async () => {
						try {
							const freshGuild = await interaction.client.guilds.fetch(guild.id).catch(() => null);
							if (!freshGuild) return;
							const freshCh = freshGuild.channels.cache.get(ch.id);
							if (freshCh && 'permissionOverwrites' in freshCh) {
								await unlockChannel(freshCh, freshGuild.roles.everyone, 'Lock duration expired');
								if (freshCh.isTextBased()) {
									const unlockNotice = makeContainer({ color: Colors.Success });
									unlockNotice.addTextDisplayComponents(
										new TextDisplayBuilder().setContent('🔓 Channel unlocked automatically (duration expired).'),
									);
									await freshCh.send({ components: [unlockNotice], flags: CV2_FLAG }).catch(() => null);
								}
							}
						} catch {}
					}, durationMs);
				}
			} catch (err) {
				this.container.logger.error(err);
			}
		}

		await sendModLog(
			guild,
			logContainer({
				title: 'Channels Locked',
				color: Colors.Warning,
				fields: [
					{
						name: 'Scope',
						value: lockAll ? 'Server-wide' : category ? `Category <#${category.id}>` : `<#${channelsToLock[0].id}>`,
					},
					{ name: 'Locked Channels', value: `${lockedCount}` },
					{ name: 'Reason', value: reason },
					{ name: 'Duration', value: durationMs ? humanDuration(durationMs) : 'Permanent' },
					{ name: 'Moderator', value: `${userMention(interaction.user.id)} (${interaction.user.username})` },
				],
				timestamp: true,
			}),
		).catch(() => null);

		const scopeLabel = lockAll
			? 'all channels'
			: category
				? `all channels in category **${category.name}**`
				: `<#${channelsToLock[0].id}>`;
		return interaction.editReply(successReply(`Successfully locked **${lockedCount}** channel(s) (${scopeLabel}).`));
	}

	// ── /mod unlock ────────────────────────────────────────────────────────────
	public async chatInputUnlock(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}

		if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
			return interaction.editReply(errorReply('You do not have permission to manage channels.'));
		}

		const reason = interaction.options.getString('reason') ?? 'No reason provided';
		const unlockAll = interaction.options.getBoolean('all') ?? false;
		const category = interaction.options.getChannel('category');
		const guild = interaction.guild;
		const auditReason = `[${interaction.user.username}] Unlock — ${reason}`;

		const channelsToUnlock: any[] = [];

		if (unlockAll) {
			const allChs = guild.channels.cache.filter(
				(c) =>
					c.type === ChannelType.GuildText ||
					c.type === ChannelType.GuildAnnouncement ||
					c.type === ChannelType.GuildVoice ||
					c.type === ChannelType.GuildStageVoice,
			);
			channelsToUnlock.push(...allChs.values());
		} else if (category) {
			const catChs = guild.channels.cache.filter((c) => c.parentId === category.id);
			channelsToUnlock.push(...catChs.values());
		} else {
			const channel = interaction.options.getChannel('channel') ?? interaction.channel;
			if (channel) {
				channelsToUnlock.push(channel);
			}
		}

		if (channelsToUnlock.length === 0) {
			return interaction.editReply(errorReply('No eligible channels found to unlock.'));
		}

		let unlockedCount = 0;
		for (const ch of channelsToUnlock) {
			if (!('permissionOverwrites' in ch)) continue;
			try {
				await unlockChannel(ch, guild.roles.everyone, auditReason);
				unlockedCount++;

				if (ch.isTextBased()) {
					const notice = makeContainer({ color: Colors.Success });
					notice.addTextDisplayComponents(
						new TextDisplayBuilder().setContent(`🔓 This channel has been unlocked by ${interaction.user.username}.`),
					);
					await ch.send({ components: [notice], flags: CV2_FLAG }).catch(() => null);
				}
			} catch (err) {
				this.container.logger.error(err);
			}
		}

		await sendModLog(
			guild,
			logContainer({
				title: 'Channels Unlocked',
				color: Colors.Success,
				fields: [
					{
						name: 'Scope',
						value: unlockAll ? 'Server-wide' : category ? `Category <#${category.id}>` : `<#${channelsToUnlock[0].id}>`,
					},
					{ name: 'Unlocked Channels', value: `${unlockedCount}` },
					{ name: 'Reason', value: reason },
					{ name: 'Moderator', value: `${userMention(interaction.user.id)} (${interaction.user.username})` },
				],
				timestamp: true,
			}),
		).catch(() => null);

		const scopeLabel = unlockAll
			? 'all channels'
			: category
				? `all channels in category **${category.name}**`
				: `<#${channelsToUnlock[0].id}>`;
		return interaction.editReply(
			successReply(`Successfully unlocked **${unlockedCount}** channel(s) (${scopeLabel}).`),
		);
	}

	// ── /mod slowmode ──────────────────────────────────────────────────────────
	public async chatInputSlowmode(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}

		if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
			return interaction.editReply(errorReply('You do not have permission to manage channels.'));
		}

		const durationStr = interaction.options.getString('duration', true);
		const all = interaction.options.getBoolean('all') ?? false;
		const resetAfter = interaction.options.getString('reset_after');
		const guild = interaction.guild;

		const seconds = parseSlowmodeDuration(durationStr);
		if (seconds === null || seconds < 0 || seconds > 21600) {
			return interaction.editReply(errorReply('Invalid slowmode duration. Please specify a value between 0s and 6h.'));
		}

		const channel =
			(interaction.options.getChannel('channel') as import('discord.js').TextChannel | null) ??
			(interaction.channel as import('discord.js').TextChannel);

		if (!all && (!channel || !('setRateLimitPerUser' in channel))) {
			return interaction.editReply(errorReply('That channel does not support slowmode.'));
		}

		try {
			const channelsToUpdate: import('discord.js').TextChannel[] = [];
			if (all) {
				const textChannels = guild.channels.cache.filter(
					(c) =>
						(c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement) &&
						'setRateLimitPerUser' in c,
				);
				channelsToUpdate.push(...(Array.from(textChannels.values()) as import('discord.js').TextChannel[]));
			} else {
				channelsToUpdate.push(channel);
			}

			if (channelsToUpdate.length === 0) {
				return interaction.editReply(errorReply('No text channels found to update.'));
			}

			for (const ch of channelsToUpdate) {
				await ch.setRateLimitPerUser(seconds, `[${interaction.user.username}] Slowmode command`);
			}

			let resetMsg = '';
			if (resetAfter) {
				const ms = parseDuration(resetAfter);
				if (ms) {
					setTimeout(async () => {
						try {
							const freshGuild = await interaction.client.guilds.fetch(guild.id).catch(() => null);
							if (!freshGuild) return;
							for (const ch of channelsToUpdate) {
								const targetCh = freshGuild.channels.cache.get(ch.id);
								if (targetCh && 'setRateLimitPerUser' in targetCh) {
									await (targetCh as any).setRateLimitPerUser(0, 'Slowmode timer expired').catch(() => null);
								}
							}
						} catch {}
					}, ms);
					resetMsg = `\n⏱️ Automatically disables <t:${Math.floor((Date.now() + ms) / 1000)}:R>.`;
				}
			}

			const msg =
				seconds === 0
					? `Slowmode disabled in ${all ? 'all channels' : `<#${channel.id}>`}.${resetMsg}`
					: `Slowmode set to **${seconds}s** in ${all ? 'all channels' : `<#${channel.id}>`}.${resetMsg}`;

			await sendModLog(
				guild,
				logContainer({
					title: seconds === 0 ? 'Slowmode Disabled' : 'Slowmode Set',
					color: seconds === 0 ? Colors.Success : Colors.Moderation,
					fields: [
						{ name: 'Scope', value: all ? 'All Channels' : `<#${channel.id}>` },
						...(seconds > 0 ? [{ name: 'Delay', value: `${seconds}s` }] : []),
						{ name: 'Reset After', value: resetAfter ? humanDuration(parseDuration(resetAfter) ?? 0) : 'Never' },
						{ name: 'Set By', value: `<@${interaction.user.id}> (${interaction.user.username})` },
					],
					timestamp: true,
				}),
			).catch(() => null);

			const chId = all ? 'all' : channel.id;
			const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setCustomId(`mod:slowmode:0:${chId}`).setLabel('Disable').setStyle(ButtonStyle.Secondary),
				new ButtonBuilder().setCustomId(`mod:slowmode:10:${chId}`).setLabel('10s').setStyle(ButtonStyle.Primary),
				new ButtonBuilder().setCustomId(`mod:slowmode:60:${chId}`).setLabel('1m').setStyle(ButtonStyle.Primary),
				new ButtonBuilder().setCustomId(`mod:slowmode:300:${chId}`).setLabel('5m').setStyle(ButtonStyle.Primary),
			);

			const container = makeContainer({ color: seconds === 0 ? Colors.Success : Colors.Moderation });
			container.addTextDisplayComponents(new TextDisplayBuilder().setContent(msg));
			container.addActionRowComponents(row);

			return interaction.editReply(cv2Reply(container, true));
		} catch (err) {
			this.container.logger.error(err);
			return interaction.editReply(errorReply('Failed to set slowmode.'));
		}
	}

	public async chatInputMassBan(interaction: Subcommand.ChatInputCommandInteraction) {
		const { MassHandler } = await import('../../lib/moderation/handlers/mass.js');
		return new MassHandler().runBan(interaction);
	}

	public async chatInputMassKick(interaction: Subcommand.ChatInputCommandInteraction) {
		const { MassHandler } = await import('../../lib/moderation/handlers/mass.js');
		return new MassHandler().runKick(interaction);
	}

	public async chatInputMassTimeout(interaction: Subcommand.ChatInputCommandInteraction) {
		const { MassHandler } = await import('../../lib/moderation/handlers/mass.js');
		return new MassHandler().runTimeout(interaction);
	}

	public async chatInputMassUnban(interaction: Subcommand.ChatInputCommandInteraction) {
		const { MassHandler } = await import('../../lib/moderation/handlers/mass.js');
		return new MassHandler().runUnban(interaction);
	}

	public async chatInputMassUntimeout(interaction: Subcommand.ChatInputCommandInteraction) {
		const { MassHandler } = await import('../../lib/moderation/handlers/mass.js');
		return new MassHandler().runUntimeout(interaction);
	}

	public async chatInputMassWarn(interaction: Subcommand.ChatInputCommandInteraction) {
		const { MassHandler } = await import('../../lib/moderation/handlers/mass.js');
		return new MassHandler().runWarn(interaction);
	}

	private async upsert(guildId: string, patch: Partial<typeof schema.guilds.$inferInsert>) {
		await db
			.insert(schema.guilds)
			.values({ id: guildId, ...patch })
			.onDuplicateKeyUpdate({
				set: patch,
			});
	}

	// ── warndecay ──────────────────────────────────────────────────────────
	public async chatInputWarnDecay(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}

		const days = interaction.options.getInteger('days');

		if (!days) {
			await this.upsert(interaction.guildId, { warnDecayDays: null });
			return interaction.editReply(successReply('Warning decay disabled. Warnings will never expire.'));
		}

		await this.upsert(interaction.guildId, { warnDecayDays: days });
		return interaction.editReply(
			successReply(`Warning decay set to **${days} day(s)**. Old warnings will expire dynamically.`),
		);
	}

	// ── proofrequired ──────────────────────────────────────────────────────
	public async chatInputProofRequired(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}

		const enabled = interaction.options.getBoolean('enabled', true);
		await this.upsert(interaction.guildId, { proofRequired: enabled });
		return interaction.editReply(
			successReply(
				`Proof requirement has been ${enabled ? 'enabled ✅ (proof attachment is now required for punishments)' : 'disabled ❌'}.`,
			),
		);
	}

	// ── requirereview ──────────────────────────────────────────────────────
	public async chatInputRequireReview(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}

		const enabled = interaction.options.getBoolean('enabled', true);
		await this.upsert(interaction.guildId, { requireReview: enabled });
		return interaction.editReply(
			successReply(
				`Review requirement has been ${enabled ? 'enabled ✅ (moderators must confirm punishments before execution)' : 'disabled ❌'}.`,
			),
		);
	}

	// ── presets handlers ───────────────────────────────────────────────────────────
	public async chatInputPresetsAdd(interaction: Subcommand.ChatInputCommandInteraction) {
		const { PresetsHandler } = await import('../../lib/config/handlers/presets.js');
		return new PresetsHandler().runAdd(interaction);
	}
	public async chatInputPresetsRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		const { PresetsHandler } = await import('../../lib/config/handlers/presets.js');
		return new PresetsHandler().runRemove(interaction);
	}
	public async chatInputPresetsList(interaction: Subcommand.ChatInputCommandInteraction) {
		const { PresetsHandler } = await import('../../lib/config/handlers/presets.js');
		return new PresetsHandler().runList(interaction);
	}

	// ── autorole handlers ──────────────────────────────────────────────────────────
	public async chatInputAutoRoleAdd(interaction: Subcommand.ChatInputCommandInteraction) {
		const { AutoroleHandler } = await import('../../lib/config/handlers/autorole.js');
		return new AutoroleHandler().runAdd(interaction);
	}
	public async chatInputAutoRoleRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		const { AutoroleHandler } = await import('../../lib/config/handlers/autorole.js');
		return new AutoroleHandler().runRemove(interaction);
	}
	public async chatInputAutoRoleList(interaction: Subcommand.ChatInputCommandInteraction) {
		const { AutoroleHandler } = await import('../../lib/config/handlers/autorole.js');
		return new AutoroleHandler().runList(interaction);
	}

	// ── escalation handlers ────────────────────────────────────────────────────────
	public async chatInputEscalationAdd(interaction: Subcommand.ChatInputCommandInteraction) {
		const { EscalationHandler } = await import('../../lib/config/handlers/escalation.js');
		return new EscalationHandler().runAdd(interaction);
	}
	public async chatInputEscalationRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		const { EscalationHandler } = await import('../../lib/config/handlers/escalation.js');
		return new EscalationHandler().runRemove(interaction);
	}
	public async chatInputEscalationView(interaction: Subcommand.ChatInputCommandInteraction) {
		const { EscalationHandler } = await import('../../lib/config/handlers/escalation.js');
		return new EscalationHandler().runView(interaction);
	}
	public async chatInputEscalationTest(interaction: Subcommand.ChatInputCommandInteraction) {
		const { EscalationHandler } = await import('../../lib/config/handlers/escalation.js');
		return new EscalationHandler().runTest(interaction);
	}

	// ── note handlers ────────────────────────────────────────────────────────────
	public async chatInputNoteAdd(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const target = interaction.options.getUser('user', true);
		const content = interaction.options.getString('note', true);
		const note = await createNote(interaction.guildId, target.id, interaction.user.id, content);

		return interaction.editReply(
			successReply(`Note **#${note.id}** added for **${target.username}** (\`${target.id}\`).`),
		);
	}

	public async chatInputNoteList(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const target = interaction.options.getUser('user', true);
		const page = interaction.options.getInteger('page') ?? 1;

		const payload = await buildNotesPage(interaction.guildId, target.id, target.username, page - 1);
		return interaction.editReply(payload);
	}

	public async chatInputNoteDelete(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const id = interaction.options.getInteger('id', true);
		const deleted = await deleteNote(interaction.guildId, id);

		if (!deleted) {
			return interaction.editReply(errorReply(`Note **#${id}** not found in this server.`));
		}

		return interaction.editReply(successReply(`Note **#${id}** deleted.`));
	}

	public async chatInputNoteEdit(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const id = interaction.options.getInteger('id', true);
		const noteContent = interaction.options.getString('note', true).trim();

		const existing = await db
			.select()
			.from(schema.modNotes)
			.where(and(eq(schema.modNotes.guildId, interaction.guildId), eq(schema.modNotes.id, id)))
			.limit(1)
			.then((r) => r[0] ?? null);

		if (!existing) {
			return interaction.editReply(errorReply(`Note **#${id}** not found in this server.`));
		}

		await db
			.update(schema.modNotes)
			.set({ content: noteContent })
			.where(and(eq(schema.modNotes.guildId, interaction.guildId), eq(schema.modNotes.id, id)));

		return interaction.editReply(successReply(`Note **#${id}** has been updated.`));
	}

	public async chatInputNoteClear(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const target = interaction.options.getUser('user', true);

		const result = await db
			.delete(schema.modNotes)
			.where(and(eq(schema.modNotes.guildId, interaction.guildId), eq(schema.modNotes.userId, target.id)));
		const deletedCount = Number((result as any)[0]?.affectedRows ?? 0);

		if (deletedCount === 0) {
			return interaction.editReply(warningReply(`No notes found to clear for **${target.username}**.`));
		}

		return interaction.editReply(
			successReply(`Successfully cleared all **${deletedCount}** note(s) for **${target.username}**.`),
		);
	}

	// ── nick handler ─────────────────────────────────────────────────────────────
	public async chatInputNick(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}

		const target = interaction.options.getMember('user');
		if (!target) {
			return interaction.editReply(errorReply('That user is not in this server.'));
		}

		if (!target.manageable) {
			return interaction.editReply(errorReply('I cannot manage this member (missing permissions or higher role).'));
		}

		const h = checkHierarchy(interaction.member, target);
		if (!h.ok) return interaction.editReply(errorReply(h.reason));

		if (target.id === interaction.guild.ownerId && interaction.user.id !== interaction.guild.ownerId) {
			return interaction.editReply(errorReply("You cannot change the server owner's nickname."));
		}

		const nickname = interaction.options.getString('nickname');

		const oldNick = target.nickname ?? '*(none)*';

		try {
			await target.setNickname(nickname, `Changed by ${interaction.user.username}`);

			await sendModLog(
				interaction.guild,
				logContainer({
					title: 'Nickname Changed',
					color: Colors.Neutral,
					fields: [
						{ name: 'User', value: `${userMention(target.id)} (${target.user.username} • \`${target.id}\`)` },
						{ name: 'Old nickname', value: oldNick },
						{ name: 'New nickname', value: nickname ?? '*(cleared)*' },
						{ name: 'Changed by', value: `${userMention(interaction.user.id)} (${interaction.user.username})` },
					],
					timestamp: true,
				}),
			).catch(() => null);

			return interaction.editReply(
				nickname
					? successReply(`Nickname for **${target.user.username}** set to **${nickname}**.`)
					: successReply(`Nickname for **${target.user.username}** cleared.`),
			);
		} catch {
			return interaction.editReply(errorReply('Failed to update nickname.'));
		}
	}

	// ── role handlers ────────────────────────────────────────────────────────────
	public async chatInputRoleAdd(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}

		const target = interaction.options.getMember('user');
		const role = interaction.options.getRole('role', true);
		const reason = interaction.options.getString('reason') ?? `Role added by ${interaction.user.username}`;

		if (!target) {
			return interaction.editReply(errorReply('That user is not in this server.'));
		}

		const botTop = interaction.guild.members.me?.roles.highest;
		if (botTop && role.position >= botTop.position) {
			return interaction.editReply(errorReply('That role is equal to or higher than my highest role.'));
		}

		const modTop = interaction.member.roles.highest;
		if (role.position >= modTop.position && interaction.user.id !== interaction.guild.ownerId) {
			return interaction.editReply(errorReply('You cannot manage roles equal to or higher than your own.'));
		}

		if (target.roles.cache.has(role.id)) {
			return interaction.editReply(warningReply(`**${target.user.username}** already has <@&${role.id}>.`));
		}
		try {
			await target.roles.add(role.id, reason);
			await sendModLog(
				interaction.guild,
				logContainer({
					title: 'Role Added',
					color: Colors.Neutral,
					fields: [
						{ name: 'User', value: `${userMention(target.id)} (${target.user.username} • \`${target.id}\`)` },
						{ name: 'Role', value: `<@&${role.id}> (${role.name})` },
						{ name: 'Reason', value: reason },
						{ name: 'Moderator', value: `${userMention(interaction.user.id)} (${interaction.user.username})` },
					],
					timestamp: true,
				}),
			).catch(() => null);
			return interaction.editReply(successReply(`Added <@&${role.id}> to **${target.user.username}**.`));
		} catch {
			return interaction.editReply(errorReply('Failed to add role.'));
		}
	}

	public async chatInputRoleRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}

		const target = interaction.options.getMember('user');
		const role = interaction.options.getRole('role', true);
		const reason = interaction.options.getString('reason') ?? `Role removed by ${interaction.user.username}`;

		if (!target) {
			return interaction.editReply(errorReply('That user is not in this server.'));
		}

		const botTop = interaction.guild.members.me?.roles.highest;
		if (botTop && role.position >= botTop.position) {
			return interaction.editReply(errorReply('That role is equal to or higher than my highest role.'));
		}

		const modTop = interaction.member.roles.highest;
		if (role.position >= modTop.position && interaction.user.id !== interaction.guild.ownerId) {
			return interaction.editReply(errorReply('You cannot manage roles equal to or higher than your own.'));
		}

		if (!target.roles.cache.has(role.id)) {
			return interaction.editReply(warningReply(`**${target.user.username}** does not have <@&${role.id}>.`));
		}
		try {
			await target.roles.remove(role.id, reason);
			await sendModLog(
				interaction.guild,
				logContainer({
					title: 'Role Removed',
					color: Colors.Neutral,
					fields: [
						{ name: 'User', value: `${userMention(target.id)} (${target.user.username} • \`${target.id}\`)` },
						{ name: 'Role', value: `<@&${role.id}> (${role.name})` },
						{ name: 'Reason', value: reason },
						{ name: 'Moderator', value: `${userMention(interaction.user.id)} (${interaction.user.username})` },
					],
					timestamp: true,
				}),
			).catch(() => null);
			return interaction.editReply(successReply(`Removed <@&${role.id}> from **${target.user.username}**.`));
		} catch {
			return interaction.editReply(errorReply('Failed to remove role.'));
		}
	}

	// ── timerole handlers ────────────────────────────────────────────────────────
	public async chatInputTimeroleGive(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const target = interaction.options.getMember('user');
		const role = interaction.options.getRole('role', true);
		const durationStr = interaction.options.getString('duration', true);

		if (!target) return interaction.editReply(errorReply('That user is not in this server.'));

		const durationMs = parseDuration(durationStr);
		if (!durationMs) return interaction.editReply(errorReply('Invalid duration. Use formats like `1h`, `7d`, `30m`.'));
		const maxMs = 365 * 24 * 60 * 60 * 1000;
		if (durationMs > maxMs) return interaction.editReply(errorReply('Maximum duration is 1 year.'));

		if (!target.manageable) return interaction.editReply(errorReply('I cannot manage roles for that member.'));
		if (role.managed) return interaction.editReply(errorReply('Cannot assign managed/integration roles.'));

		const expiresAt = new Date(Date.now() + durationMs);

		await target.roles.add(role.id).catch(() => null);

		const [idRow] = await db
			.insert(schema.timedRoles)
			.values({
				guildId: interaction.guildId,
				userId: target.id,
				roleId: role.id,
				expiresAt,
				grantedById: interaction.user.id,
			})
			.$returningId();
		const [row] = await db.select().from(schema.timedRoles).where(eq(schema.timedRoles.id, idRow.id)).limit(1);
		if (!row) return interaction.editReply(errorReply('Failed to create timed role.'));

		return interaction.editReply(
			successReply(
				`Gave <@&${role.id}> to <@${target.id}> for **${humanDuration(durationMs)}**.\nExpires <t:${Math.floor(expiresAt.getTime() / 1000)}:R>. ID: \`${row.id}\``,
			),
		);
	}

	public async chatInputTimeroleRevoke(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const id = interaction.options.getInteger('id', true);
		const row = await db.query.timedRoles.findFirst({
			where: and(eq(schema.timedRoles.id, id), eq(schema.timedRoles.guildId, interaction.guildId)),
		});

		if (!row || row.done) return interaction.editReply(errorReply(`No active timed role with ID \`${id}\`.`));

		await db.update(schema.timedRoles).set({ done: true }).where(eq(schema.timedRoles.id, id));

		const member = await interaction.guild.members.fetch(row.userId).catch(() => null);
		if (member) await member.roles.remove(row.roleId).catch(() => null);

		return interaction.editReply(successReply(`Revoked <@&${row.roleId}> from <@${row.userId}>.`));
	}

	public async chatInputTimeroleList(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const filterUser = interaction.options.getUser('user');

		const rows = await db.query.timedRoles.findMany({
			where: and(
				eq(schema.timedRoles.guildId, interaction.guildId),
				eq(schema.timedRoles.done, false),
				...(filterUser ? [eq(schema.timedRoles.userId, filterUser.id)] : []),
			),
		});

		if (!rows.length) return interaction.editReply(errorReply('No active timed roles.'));

		const lines = rows.map(
			(r) =>
				`\`#${r.id}\` <@${r.userId}> → <@&${r.roleId}> — expires <t:${Math.floor(r.expiresAt.getTime() / 1000)}:R>`,
		);

		const container = new ContainerBuilder().setAccentColor(Colors.Info);
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(`### ⏱️ Active Timed Roles\n${lines.join('\n')}`),
		);
		container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(`-# ${rows.length} active • Use \`/timerole revoke <id>\` to remove early`),
		);

		return interaction.editReply({ components: [container], flags: (CV2_FLAG | MessageFlags.Ephemeral) as any });
	}

	// ── dehoist handlers ─────────────────────────────────────────────────────────
	public async chatInputDehoistUser(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const member = interaction.options.getMember('user');
		if (!member) return interaction.editReply(errorReply('Member not found in this server.'));

		if (!member.manageable) {
			return interaction.editReply(errorReply('I cannot manage this member (missing permissions or higher role).'));
		}

		const h = checkHierarchy(interaction.member, member);
		if (!h.ok) return interaction.editReply(errorReply(h.reason));

		const regex = getHoistRegex();
		if (!regex.test(member.displayName)) {
			return interaction.editReply(errorReply('This member is not currently hoisted.'));
		}

		const oldNick = member.displayName;
		let newNick = oldNick.replace(regex, '').trim();
		if (newNick.length < 2) {
			newNick = `Dehoisted ${member.user.username.slice(0, 20)}`;
		}

		try {
			await member.setNickname(newNick, 'Dehoisted via /dehoist user');
			return interaction.editReply(successReply(`Successfully dehoisted **${oldNick}** to **${newNick}**.`));
		} catch (err) {
			this.container.logger.error(err);
			return interaction.editReply(errorReply('Failed to dehoist user.'));
		}
	}

	public async chatInputDehoistList(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const exclude = interaction.options.getString('exclude');
		const regex = getHoistRegex(exclude);

		const members = await interaction.guild.members.fetch();
		const hoisted = members.filter((m) => !m.user.bot && regex.test(m.displayName));

		const c = makeContainer({
			color: hoisted.size === 0 ? Colors.Success : Colors.Info,
			header: `Hoisted Members (${hoisted.size})`,
		});

		if (hoisted.size === 0) {
			c.addTextDisplayComponents(new TextDisplayBuilder().setContent('No hoisted members found.'));
		} else {
			c.addSeparatorComponents(separator());
			const lines = hoisted.map((m) => `${userMention(m.id)} (${m.displayName})`).slice(0, 30);
			c.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));

			if (hoisted.size > 30) {
				c.addSeparatorComponents(separator());
				c.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(`-# Showing 30 of ${hoisted.size} hoisted members.`),
				);
			}
		}

		return interaction.editReply({ components: [c], flags: CV2_FLAG });
	}

	public async chatInputDehoistClean(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const exclude = interaction.options.getString('exclude');
		const regex = getHoistRegex(exclude);

		const members = await interaction.guild.members.fetch();
		const hoisted = members.filter((m) => !m.user.bot && m.manageable && regex.test(m.displayName));

		if (hoisted.size === 0) {
			return interaction.editReply(successReply('No manageable hoisted members to clean.'));
		}

		let cleanedCount = 0;
		for (const member of hoisted.values()) {
			const oldNick = member.displayName;
			let newNick = oldNick.replace(regex, '').trim();
			if (newNick.length < 2) {
				newNick = `Dehoisted ${member.user.username.slice(0, 20)}`;
			}
			const ok = await member.setNickname(newNick, 'Bulk dehoisted').catch(() => null);
			if (ok) cleanedCount++;
		}

		return interaction.editReply(successReply(`Successfully cleaned **${cleanedCount}** hoisted nicknames.`));
	}

	// ── announce handler ─────────────────────────────────────────────────────────
	public async chatInputAnnounce(interaction: Subcommand.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return;

		const channel = interaction.options.getChannel('channel', true);
		const colorKey = interaction.options.getString('color') ?? 'blue';
		const ping = interaction.options.getMentionable('ping');

		const pingType = ping instanceof Role ? 'r' : ping ? 'u' : 'none';
		const pingId = ping && 'id' in ping ? ping.id : '';

		const modal = new ModalBuilder()
			.setCustomId(`announce_modal:${channel.id}:${colorKey}:${pingType}:${pingId}`)
			.setTitle('New Announcement')
			.addComponents(
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder()
						.setCustomId('heading')
						.setLabel('Heading (optional)')
						.setStyle(TextInputStyle.Short)
						.setRequired(false)
						.setMaxLength(100),
				),
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder()
						.setCustomId('body')
						.setLabel('Message')
						.setStyle(TextInputStyle.Paragraph)
						.setRequired(true),
				),
			);

		return interaction.showModal(modal);
	}

	// ── honeypot handler ─────────────────────────────────────────────────────────
	public async chatInputHoneypot(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild())
			return interaction.editReply(errorReply('This command can only be used in a server.'));

		const enabled = interaction.options.getBoolean('enabled', true);
		const punishment = (interaction.options.getString('punishment') ?? 'ban') as 'warn' | 'timeout' | 'kick' | 'ban';
		const durationStr = interaction.options.getString('duration');
		const channelOption = interaction.options.getChannel('channel');

		const targetChannel = channelOption ?? interaction.channel;
		if (
			!targetChannel ||
			(targetChannel.type !== ChannelType.GuildText && targetChannel.type !== ChannelType.GuildAnnouncement)
		) {
			return interaction.editReply(errorReply('Target channel must be a text-based guild channel.'));
		}

		const guild = interaction.guild!;

		if (enabled) {
			let durationMs: number | null = null;
			if (durationStr) {
				const parsed = parseDuration(durationStr);
				if (!parsed) {
					return interaction.editReply(errorReply('Invalid duration format (e.g. `24h`, `7d`, `30m`).'));
				}
				durationMs = parsed;
			} else if (punishment === 'timeout') {
				// Default timeout is 24 hours
				durationMs = 24 * 60 * 60 * 1000;
			}

			// Format punishment name for display
			let actionLabel = punishment.toUpperCase();
			if (punishment === 'timeout' && durationMs) {
				actionLabel = `TIMEOUT (${humanDuration(durationMs)})`;
			} else if (punishment === 'ban' && durationMs) {
				actionLabel = `TEMP BAN (${humanDuration(durationMs)})`;
			}

			// Post announcement message in the target channel
			const announceContainer = makeContainer({ color: Colors.Warning, header: 'Honeypot Channel' });
			announceContainer.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`This channel has been designated as a **Honeypot**.\n\n` +
						`### ⛔ WARNING\n` +
						`Sending any message in this channel will result in an automatic punishment:\n` +
						`• **Action** ${actionLabel}\n\n` +
						`*Do not chat or post messages here.*`,
				),
			);

			let messageId: string | null = null;
			try {
				const ch = await guild.channels.fetch(targetChannel.id);
				if (ch && 'send' in ch) {
					const msg = await (ch as any).send({
						components: [announceContainer],
						flags: CV2_FLAG as any,
					});
					messageId = msg.id;
					await msg.pin().catch(() => null);
				}
			} catch (err) {
				this.container.logger.error(err);
				return interaction.editReply(
					errorReply('Failed to send or pin the honeypot announcement message. Do I have permissions in that channel?'),
				);
			}

			// Upsert to DB
			await db
				.insert(schema.honeypotChannels)
				.values({
					guildId: guild.id,
					channelId: targetChannel.id,
					punishment,
					duration: durationMs,
					messageId,
				})
				.onDuplicateKeyUpdate({
					set: {
						punishment,
						duration: durationMs,
						messageId,
					},
				});

			return interaction.editReply(
				successReply(
					`Successfully configured <#${targetChannel.id}> as a honeypot with punishment **${actionLabel}**.`,
				),
			);
		} else {
			// Disable honeypot
			const [existing] = await db
				.select()
				.from(schema.honeypotChannels)
				.where(eq(schema.honeypotChannels.channelId, targetChannel.id))
				.limit(1);

			if (!existing) {
				return interaction.editReply(errorReply(`<#${targetChannel.id}> is not currently a honeypot.`));
			}

			// Try to delete announcement message
			if (existing.messageId) {
				try {
					const ch = await guild.channels.fetch(targetChannel.id);
					if (ch && 'messages' in ch) {
						const msg = await (ch as any).messages.fetch(existing.messageId).catch(() => null);
						if (msg) {
							await msg.delete().catch(() => null);
						}
					}
				} catch (err) {
					this.container.logger.error(err);
				}
			}

			await db.delete(schema.honeypotChannels).where(eq(schema.honeypotChannels.channelId, targetChannel.id));

			return interaction.editReply(successReply(`Successfully removed honeypot status from <#${targetChannel.id}>.`));
		}
	}
}
