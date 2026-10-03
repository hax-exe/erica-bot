import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { ChannelType, escapeMarkdown, MessageFlags, PermissionFlagsBits, Role, TextDisplayBuilder } from 'discord.js';
import { and, asc, count, eq } from 'drizzle-orm';
import {
	ANNOUNCE_COLOR_CHOICES,
	ANNOUNCE_PING_PERMISSION_ERROR,
	botPostPermissionError,
	buildAnnouncementModal,
	canSendAnnouncePing,
	DEFAULT_ANNOUNCE_COLOR,
	MAX_ACTIVE_SCHEDULES,
	SCHEDULE_BODY_MAX_LENGTH,
	SCHEDULE_MAX_DELAY_MS,
	SCHEDULE_MAX_INTERVAL_MS,
	SCHEDULE_MIN_DELAY_MS,
	SCHEDULE_MIN_INTERVAL_MS,
	storePendingSchedule,
} from '../../lib/AnnouncementUtil.js';
import {
	Colors,
	cv2Reply,
	errorReply,
	hint,
	makeContainer,
	spacer,
	successReply,
	warningReply,
} from '../../lib/components.js';
import { clip, joinLinesCapped } from '../../lib/config/listFormat.js';
import { db, schema } from '../../lib/database.js';
import { autocompleteDuration, DURATION_HINT, humanDuration, parseDuration } from '../../lib/parseDuration.js';

const table = schema.scheduledAnnouncements;

@ApplyOptions<Subcommand.Options>({
	name: 'schedule',
	description: 'Schedule one-off or recurring announcements.',
	requiredUserPermissions: [PermissionFlagsBits.ManageGuild],
	preconditions: ['Moderation'],
	subcommands: [
		{ name: 'create', chatInputRun: 'chatInputCreate' },
		{ name: 'list', chatInputRun: 'chatInputList' },
		{ name: 'delete', chatInputRun: 'chatInputDelete' },
	],
})
export class ScheduleCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('schedule')
				.setDescription('Schedule one-off or recurring announcements.')
				.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
				.addSubcommand((sub) =>
					sub
						.setName('create')
						.setDescription('Schedule an announcement (opens a form for the heading and message).')
						.addChannelOption((o) =>
							o
								.setName('channel')
								.setDescription('Channel to post the announcement in.')
								.addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
								.setRequired(true),
						)
						.addStringOption((o) =>
							o
								.setName('in')
								.setDescription('When to post it (e.g. 30m, 2h, 1d). 1 minute to 365 days.')
								.setRequired(true)
								.setAutocomplete(true),
						)
						.addStringOption((o) =>
							o
								.setName('every')
								.setDescription('Repeat interval — makes it recurring (e.g. 1d, 1w). At least 10 minutes.')
								.setRequired(false)
								.setAutocomplete(true),
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
								.addChoices(...ANNOUNCE_COLOR_CHOICES),
						),
				)
				.addSubcommand((sub) => sub.setName('list').setDescription('List active scheduled announcements.'))
				.addSubcommand((sub) =>
					sub
						.setName('delete')
						.setDescription('Delete a scheduled announcement.')
						.addIntegerOption((o) =>
							o
								.setName('id')
								.setDescription('Schedule ID from /schedule list.')
								.setRequired(true)
								.setMinValue(1)
								.setAutocomplete(true),
						),
				),
		);
	}

	public override async autocompleteRun(interaction: Subcommand.AutocompleteInteraction) {
		const focused = interaction.options.getFocused(true);
		if (focused.name === 'in') {
			return interaction.respond(autocompleteDuration(focused.value));
		}
		if (focused.name === 'every') {
			// Only offer presets that pass the 10-minute minimum.
			return interaction.respond(
				autocompleteDuration(focused.value).filter((p) => (parseDuration(p.value) ?? 0) >= SCHEDULE_MIN_INTERVAL_MS),
			);
		}
		if (focused.name === 'id') {
			// Autocomplete skips preconditions, so gate the schedule contents here.
			if (!interaction.guildId || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
				return interaction.respond([]);
			}
			const rows = await db
				.select({ id: table.id, heading: table.heading, body: table.body })
				.from(table)
				.where(and(eq(table.guildId, interaction.guildId), eq(table.active, true)))
				.orderBy(asc(table.nextRunAt))
				.limit(MAX_ACTIVE_SCHEDULES);
			const q = String(focused.value).toLowerCase();
			return interaction.respond(
				rows
					.map((r) => ({ id: r.id, label: `#${r.id} — ${scheduleTitle(r.heading, r.body)}` }))
					.filter((r) => !q || r.label.toLowerCase().includes(q))
					.slice(0, 25)
					.map((r) => ({ name: clip(r.label, 100), value: r.id })),
			);
		}
		return interaction.respond([]);
	}

	// ── create ───────────────────────────────────────────────────────────────────
	// Ends in showModal(), so nothing may defer or reply first: errors use reply() directly.
	public async chatInputCreate(interaction: Subcommand.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) {
			return interaction.reply(errorReply('This command can only be used in a server.') as any);
		}

		const channel = interaction.options.getChannel('channel', true, [
			ChannelType.GuildText,
			ChannelType.GuildAnnouncement,
		]);
		const inStr = interaction.options.getString('in', true);
		const everyStr = interaction.options.getString('every');
		const ping = interaction.options.getMentionable('ping');
		const color = interaction.options.getString('color') ?? DEFAULT_ANNOUNCE_COLOR;

		const delayMs = parseDuration(inStr);
		if (!delayMs) {
			return interaction.reply(errorReply(`Invalid start time. ${DURATION_HINT}`) as any);
		}
		if (delayMs < SCHEDULE_MIN_DELAY_MS || delayMs > SCHEDULE_MAX_DELAY_MS) {
			return interaction.reply(errorReply('The start time must be between 1 minute and 365 days from now.') as any);
		}

		let intervalMs: number | null = null;
		if (everyStr) {
			intervalMs = parseDuration(everyStr);
			if (!intervalMs) {
				return interaction.reply(errorReply(`Invalid repeat interval. ${DURATION_HINT}`) as any);
			}
			if (intervalMs < SCHEDULE_MIN_INTERVAL_MS) {
				return interaction.reply(errorReply('The repeat interval must be at least 10 minutes.') as any);
			}
			if (intervalMs > SCHEDULE_MAX_INTERVAL_MS) {
				return interaction.reply(errorReply('The repeat interval can be at most 365 days.') as any);
			}
		}

		// A schedule the bot can never post would only be deactivated at its first run.
		const me = interaction.guild.members.me ?? (await interaction.guild.members.fetchMe().catch(() => null));
		const botError = botPostPermissionError(channel, me);
		if (botError) {
			return interaction.reply(errorReply(botError) as any);
		}

		const pingType = ping instanceof Role ? 'r' : ping ? 'u' : null;
		const pingId = ping ? ping.id : null;
		if (!canSendAnnouncePing(interaction.member, channel, pingType, pingId)) {
			return interaction.reply(errorReply(ANNOUNCE_PING_PERMISSION_ERROR) as any);
		}

		const [{ active }] = await db
			.select({ active: count() })
			.from(table)
			.where(and(eq(table.guildId, interaction.guildId), eq(table.active, true)));
		if (active >= MAX_ACTIVE_SCHEDULES) {
			return interaction.reply(
				errorReply(
					`This server already has **${MAX_ACTIVE_SCHEDULES}** active scheduled announcements. Delete one with \`/schedule delete\` first.`,
				) as any,
			);
		}

		const nonce = storePendingSchedule({
			userId: interaction.user.id,
			guildId: interaction.guildId,
			channelId: channel.id,
			delayMs,
			intervalMs,
			pingType,
			pingId,
			color,
		});

		return interaction.showModal(
			buildAnnouncementModal({
				customId: `schedule_modal:${nonce}`,
				title: 'Schedule Announcement',
				bodyMaxLength: SCHEDULE_BODY_MAX_LENGTH,
			}),
		);
	}

	// ── list ─────────────────────────────────────────────────────────────────────
	public async chatInputList(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}

		const rows = await db
			.select()
			.from(table)
			.where(and(eq(table.guildId, interaction.guildId), eq(table.active, true)))
			.orderBy(asc(table.nextRunAt));

		if (!rows.length) {
			return interaction.editReply(
				warningReply('There are no active scheduled announcements. Create one with `/schedule create`.'),
			);
		}

		const lines = rows.map((r) => {
			const next = Math.floor(r.nextRunAt / 1000);
			const repeat = r.intervalMs ? `repeats every ${humanDuration(r.intervalMs)}` : 'once';
			return `**${escapeMarkdown(scheduleTitle(r.heading, r.body))}** \`#${r.id}\`\n-# <#${r.channelId}> · <t:${next}:f> (<t:${next}:R>) · ${repeat}`;
		});

		const container = makeContainer({ color: Colors.Info, header: 'Scheduled Announcements' });
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(joinLinesCapped(lines, 3500)));
		container.addSeparatorComponents(spacer());
		container.addTextDisplayComponents(
			hint(`${rows.length} of ${MAX_ACTIVE_SCHEDULES} active · remove one with \`/schedule delete\``),
		);

		return interaction.editReply(cv2Reply(container, true));
	}

	// ── delete ───────────────────────────────────────────────────────────────────
	public async chatInputDelete(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}

		const id = interaction.options.getInteger('id', true);
		const result = await db.delete(table).where(and(eq(table.id, id), eq(table.guildId, interaction.guildId)));
		const affected = Number((result as any)[0]?.affectedRows ?? 0);
		if (!affected) {
			return interaction.editReply(errorReply(`No scheduled announcement \`#${id}\` found in this server.`));
		}

		return interaction.editReply(successReply(`Scheduled announcement \`#${id}\` deleted.`));
	}
}

/** One-line label: the heading, else the first non-empty line of the body. */
function scheduleTitle(heading: string | null, body: string): string {
	const firstLine = body.split('\n').find((line) => line.trim()) ?? '';
	return clip((heading || firstLine).trim() || '(empty)', 80);
}
