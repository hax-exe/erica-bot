import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { MessageFlags, TextDisplayBuilder, userMention } from 'discord.js';
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

function isLeapYear(year: number): boolean {
	return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Next occurrence of a birthday, compared on UTC calendar dates (today counts as 0 days away).
 * Feb 29 is observed on Feb 28 in non-leap years, matching the birthday scheduler.
 */
function nextBirthday(month: number, day: number, now = new Date()): { year: number; daysUntil: number } {
	const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
	const occurrence = (year: number) =>
		Date.UTC(year, month - 1, month === 2 && day === 29 && !isLeapYear(year) ? 28 : day);

	let year = now.getUTCFullYear();
	if (occurrence(year) < today) year++;
	return { year, daysUntil: Math.round((occurrence(year) - today) / 86_400_000) };
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
				.addSubcommand((sub) => sub.setName('upcoming').setDescription('Show upcoming birthdays in this server.')),
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

		// Age they turn on their next birthday (today counts)
		const turning = year ? nextBirthday(month, day).year - year : null;
		const ageStr = turning !== null && turning > 0 ? ` (turning ${turning})` : '';
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

		const next = nextBirthday(row.month, row.day);
		const daysUntil = next.daysUntil;

		// Age turned on the next birthday; on any other day their current age is one less.
		const turning = row.year ? next.year - row.year : null;
		const age = turning !== null ? (daysUntil === 0 ? turning : turning - 1) : null;
		const ageStr = age !== null && age >= 0 ? ` (${daysUntil === 0 ? `turning ${age}` : `age ${age}`})` : '';

		const container = makeContainer({ color: 0xf47fff });
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`🎂 **${target.displayName}**'s birthday is **${formatBirthday(row.month, row.day)}**${ageStr}\n-# ${daysUntil === 0 ? '🎉 Today!' : `${daysUntil} day(s) away`}`,
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

		const sorted = rows
			.map((r) => {
				const next = nextBirthday(r.month, r.day, now);
				return { ...r, daysUntil: next.daysUntil, nextYear: next.year };
			})
			.sort((a, b) => a.daysUntil - b.daysUntil)
			.slice(0, 15);

		const container = makeContainer({ color: 0xf47fff, header: 'Upcoming Birthdays' });
		container.addSeparatorComponents(separator());

		for (const r of sorted) {
			// Age turned on the upcoming (or today's) birthday
			const nextAge = r.year ? r.nextYear - r.year : null;
			container.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`${userMention(r.userId)} — **${formatBirthday(r.month, r.day)}**${nextAge !== null && nextAge > 0 ? ` (turning ${nextAge})` : ''} ${r.daysUntil === 0 ? '🎉 Today!' : `(${r.daysUntil}d)`}`,
				),
			);
		}

		return interaction.editReply({ components: [container], flags: (CV2_FLAG | MessageFlags.Ephemeral) as never });
	}
}
