import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { ChannelType, MessageFlags, PermissionFlagsBits, TextDisplayBuilder, userMention } from 'discord.js';
import { and, asc, eq } from 'drizzle-orm';
import { CV2_FLAG, errorReply, makeContainer, separator, successReply, warningReply } from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';

// ─── Month helpers ─────────────────────────────────────────────────────────────

const MONTH_NAMES = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December',
];

const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; // allow 29 for Feb (leap)

function formatBirthday(month: number, day: number): string {
	return `${MONTH_NAMES[month - 1]} ${day}`;
}

function isValidDate(month: number, day: number): boolean {
	if (month < 1 || month > 12) return false;
	if (day < 1 || day > MONTH_DAYS[month - 1]) return false;
	return true;
}

// ─── Command ───────────────────────────────────────────────────────────────────

@ApplyOptions<Subcommand.Options>({
	name: 'birthday',
	description: 'Birthday system.',
	subcommands: [
		{ name: 'set', chatInputRun: 'chatInputSet' },
		{ name: 'remove', chatInputRun: 'chatInputRemove' },
		{ name: 'view', chatInputRun: 'chatInputView' },
		{ name: 'upcoming', chatInputRun: 'chatInputUpcoming' },
		{
			name: 'config',
			type: 'group',
			entries: [
				{ name: 'setchannel', chatInputRun: 'chatInputConfigSetChannel' },
				{ name: 'setrole', chatInputRun: 'chatInputConfigSetRole' },
				{ name: 'setmessage', chatInputRun: 'chatInputConfigSetMessage' },
				{ name: 'toggle', chatInputRun: 'chatInputConfigToggle' },
			],
		},
	],
})
export class BirthdayCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('birthday')
				.setDescription('Birthday system.')
				// ── set ──────────────────────────────────────────────────────────────
				.addSubcommand((sub) =>
					sub
						.setName('set')
						.setDescription('Set your birthday.')
						.addIntegerOption((o) =>
							o
								.setName('month')
								.setDescription('Birth month.')
								.setRequired(true)
								.setMinValue(1)
								.setMaxValue(12)
								.addChoices(MONTH_NAMES.map((name, i) => ({ name, value: i + 1 }))),
						)
						.addIntegerOption((o) =>
							o.setName('day').setDescription('Birth day (1–31).').setRequired(true).setMinValue(1).setMaxValue(31),
						)
						.addIntegerOption((o) =>
							o
								.setName('year')
								.setDescription('Birth year (optional, used to display age).')
								.setRequired(false)
								.setMinValue(1900)
								.setMaxValue(new Date().getUTCFullYear()),
						),
				)
				// ── remove ───────────────────────────────────────────────────────────
				.addSubcommand((sub) => sub.setName('remove').setDescription('Remove your birthday from this server.'))
				// ── view ─────────────────────────────────────────────────────────────
				.addSubcommand((sub) =>
					sub
						.setName('view')
						.setDescription("View your birthday or another member's birthday.")
						.addUserOption((o) =>
							o.setName('user').setDescription('User to look up (default: yourself).').setRequired(false),
						),
				)
				// ── upcoming ─────────────────────────────────────────────────────────
				.addSubcommand((sub) => sub.setName('upcoming').setDescription('Show upcoming birthdays in this server.'))
				// ── config group ─────────────────────────────────────────────────────
				.addSubcommandGroup((group) =>
					group
						.setName('config')
						.setDescription('Configure birthday announcements (admin).')
						.addSubcommand((sub) =>
							sub
								.setName('setchannel')
								.setDescription('Set the birthday announcement channel (omit to clear).')
								.addChannelOption((o) =>
									o
										.setName('channel')
										.setDescription('Channel for birthday messages.')
										.addChannelTypes(ChannelType.GuildText)
										.setRequired(false),
								),
						)
						.addSubcommand((sub) =>
							sub
								.setName('setrole')
								.setDescription('Set a role to assign on birthdays for 24h (omit to clear).')
								.addRoleOption((o) => o.setName('role').setDescription('Birthday role.').setRequired(false)),
						)
						.addSubcommand((sub) =>
							sub
								.setName('setmessage')
								.setDescription('Set a custom birthday message. Supports {user}, {username}, {server}. Omit to reset.')
								.addStringOption((o) =>
									o.setName('text').setDescription('Birthday message.').setMaxLength(500).setRequired(false),
								),
						)
						.addSubcommand((sub) => sub.setName('toggle').setDescription('Enable or disable birthday announcements.')),
				),
		);
	}

	// ── /birthday set ──────────────────────────────────────────────────────────

	public async chatInputSet(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const month = interaction.options.getInteger('month', true);
		const day = interaction.options.getInteger('day', true);
		const year = interaction.options.getInteger('year');

		if (!isValidDate(month, day)) {
			return interaction.editReply(errorReply(`${MONTH_NAMES[month - 1]} doesn't have a day ${day}.`));
		}

		await db
			.insert(schema.birthdays)
			.values({ userId: interaction.user.id, guildId: interaction.guildId, month, day, year: year ?? null })
			.onDuplicateKeyUpdate({
				set: { month, day, year: year ?? null, lastWished: null },
			});

		const ageStr = year ? ` (turning ${new Date().getUTCFullYear() - year + 1})` : '';
		return interaction.editReply(successReply(`Birthday set to **${formatBirthday(month, day)}**${ageStr}! 🎂`));
	}

	// ── /birthday remove ───────────────────────────────────────────────────────

	public async chatInputRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const existing = await db
			.select()
			.from(schema.birthdays)
			.where(and(eq(schema.birthdays.userId, interaction.user.id), eq(schema.birthdays.guildId, interaction.guildId)))
			.limit(1)
			.then((r) => r[0] ?? null);

		if (!existing) return interaction.editReply(warningReply("You haven't set a birthday in this server."));

		await db
			.delete(schema.birthdays)
			.where(and(eq(schema.birthdays.userId, interaction.user.id), eq(schema.birthdays.guildId, interaction.guildId)));

		return interaction.editReply(successReply('Your birthday has been removed.'));
	}

	// ── /birthday view ─────────────────────────────────────────────────────────

	public async chatInputView(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const target = interaction.options.getUser('user') ?? interaction.user;
		const isSelf = target.id === interaction.user.id;

		const row = await db
			.select()
			.from(schema.birthdays)
			.where(and(eq(schema.birthdays.userId, target.id), eq(schema.birthdays.guildId, interaction.guildId)))
			.limit(1)
			.then((r) => r[0] ?? null);

		if (!row) {
			return interaction.editReply(
				warningReply(
					isSelf
						? "You haven't set a birthday. Use `/birthday set`."
						: `**${target.displayName}** hasn't set a birthday.`,
				),
			);
		}

		const now = new Date();
		const thisYear = now.getUTCFullYear();
		const bdayThisYear = new Date(Date.UTC(thisYear, row.month - 1, row.day));
		if (bdayThisYear < now) bdayThisYear.setUTCFullYear(thisYear + 1);
		const daysUntil = Math.ceil((bdayThisYear.getTime() - now.getTime()) / 86_400_000);

		const currentAge = row.year ? new Date().getUTCFullYear() - row.year : null;
		// If today is their birthday they're turning currentAge, otherwise they're currentAge - 1
		const age = currentAge !== null ? (daysUntil === 0 ? currentAge : currentAge - 1) : null;

		const container = makeContainer({ color: 0xf47fff });
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`🎂 **${target.displayName}**'s birthday is **${formatBirthday(row.month, row.day)}**${age !== null ? ` (${daysUntil === 0 ? `turning ${age}` : `age ${age}`})` : ''}\n-# ${daysUntil === 0 ? '🎉 Today!' : `${daysUntil} day(s) away`}`,
			),
		);

		return interaction.editReply({ components: [container], flags: (CV2_FLAG | MessageFlags.Ephemeral) as never });
	}

	// ── /birthday upcoming ─────────────────────────────────────────────────────

	public async chatInputUpcoming(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const rows = await db
			.select()
			.from(schema.birthdays)
			.where(eq(schema.birthdays.guildId, interaction.guildId))
			.orderBy(asc(schema.birthdays.month), asc(schema.birthdays.day));

		if (!rows.length) return interaction.editReply(warningReply('No birthdays set in this server yet.'));

		const now = new Date();
		const thisYear = now.getUTCFullYear();

		const sorted = rows
			.map((r) => {
				const bday = new Date(Date.UTC(thisYear, r.month - 1, r.day));
				if (bday < now) bday.setUTCFullYear(thisYear + 1);
				return { ...r, daysUntil: Math.ceil((bday.getTime() - now.getTime()) / 86_400_000) };
			})
			.sort((a, b) => a.daysUntil - b.daysUntil)
			.slice(0, 15);

		const container = makeContainer({ color: 0xf47fff, header: 'Upcoming Birthdays' });
		container.addSeparatorComponents(separator());

		for (const r of sorted) {
			const nextAge = r.year ? new Date().getUTCFullYear() - r.year + (r.daysUntil === 0 ? 0 : 1) : null;
			container.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`${userMention(r.userId)} — **${formatBirthday(r.month, r.day)}**${nextAge !== null ? ` (turning ${nextAge})` : ''} ${r.daysUntil === 0 ? '🎉 Today!' : `(${r.daysUntil}d)`}`,
				),
			);
		}

		return interaction.editReply({ components: [container], flags: (CV2_FLAG | MessageFlags.Ephemeral) as never });
	}

	// ── /birthday config setchannel ────────────────────────────────────────────

	public async chatInputConfigSetChannel(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));
		if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
			return interaction.editReply(errorReply('You need Manage Server to do this.'));
		}

		const channel = interaction.options.getChannel('channel');
		await db
			.insert(schema.birthdaySettings)
			.values({ guildId: interaction.guildId, channelId: channel?.id ?? null })
			.onDuplicateKeyUpdate({ set: { channelId: channel?.id ?? null } });

		return interaction.editReply(
			channel ? successReply(`Birthday channel set to <#${channel.id}>.`) : successReply('Birthday channel cleared.'),
		);
	}

	// ── /birthday config setrole ───────────────────────────────────────────────

	public async chatInputConfigSetRole(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));
		if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
			return interaction.editReply(errorReply('You need Manage Server to do this.'));
		}

		const role = interaction.options.getRole('role');
		await db
			.insert(schema.birthdaySettings)
			.values({ guildId: interaction.guildId, roleId: role?.id ?? null })
			.onDuplicateKeyUpdate({ set: { roleId: role?.id ?? null } });

		return interaction.editReply(
			role ? successReply(`Birthday role set to <@&${role.id}>.`) : successReply('Birthday role cleared.'),
		);
	}

	// ── /birthday config setmessage ────────────────────────────────────────────

	public async chatInputConfigSetMessage(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));
		if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
			return interaction.editReply(errorReply('You need Manage Server to do this.'));
		}

		const text = interaction.options.getString('text');
		await db
			.insert(schema.birthdaySettings)
			.values({ guildId: interaction.guildId, message: text ?? null })
			.onDuplicateKeyUpdate({ set: { message: text ?? null } });

		return interaction.editReply(
			text ? successReply('Birthday message updated.') : successReply('Birthday message reset to default.'),
		);
	}

	// ── /birthday config toggle ────────────────────────────────────────────────

	public async chatInputConfigToggle(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));
		if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
			return interaction.editReply(errorReply('You need Manage Server to do this.'));
		}

		const settings = await db
			.select()
			.from(schema.birthdaySettings)
			.where(eq(schema.birthdaySettings.guildId, interaction.guildId))
			.limit(1)
			.then((r) => r[0] ?? null);

		if (!settings?.channelId) {
			return interaction.editReply(warningReply('Set a channel first with `/birthday config setchannel`.'));
		}

		const newEnabled = !settings.enabled;
		await db
			.insert(schema.birthdaySettings)
			.values({ guildId: interaction.guildId, enabled: newEnabled })
			.onDuplicateKeyUpdate({ set: { enabled: newEnabled } });

		return interaction.editReply(successReply(`Birthday announcements ${newEnabled ? 'enabled ✅' : 'disabled ❌'}.`));
	}
}
