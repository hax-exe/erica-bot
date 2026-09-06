import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { ContainerBuilder, MessageFlags, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder } from 'discord.js';
import { and, eq } from 'drizzle-orm';
import { Colors, CV2_FLAG, errorReply, successReply } from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';
import { autocompleteDuration, DURATION_HINT, humanDuration, parseDuration } from '../../lib/parseDuration.js';

const MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MIN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes minimum interval

@ApplyOptions<Subcommand.Options>({
	name: 'remind',
	description: 'Set a reminder.',
	subcommands: [
		{ name: 'me', chatInputRun: 'runMe' },
		{ name: 'list', chatInputRun: 'runList' },
		{ name: 'delete', chatInputRun: 'runDelete' },
	],
})
export class RemindCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('remind')
				.setDescription('Set a reminder.')
				.addSubcommand((sub) =>
					sub
						.setName('me')
						.setDescription('Set a reminder for yourself.')
						.addStringOption((o) =>
							o
								.setName('duration')
								.setDescription('When to remind you (e.g. 1h, 30m, 2d).')
								.setRequired(true)
								.setAutocomplete(true),
						)
						.addStringOption((o) =>
							o.setName('message').setDescription('What to remind you about.').setRequired(true).setMaxLength(500),
						)
						.addStringOption((o) =>
							o
								.setName('every')
								.setDescription('Repeat interval — makes this a recurring reminder (e.g. 1d, 1w). Min 5m.')
								.setRequired(false)
								.setAutocomplete(true),
						),
				)
				.addSubcommand((sub) => sub.setName('list').setDescription('View your pending reminders.'))
				.addSubcommand((sub) =>
					sub
						.setName('delete')
						.setDescription('Delete a pending reminder.')
						.addIntegerOption((o) =>
							o.setName('id').setDescription('Reminder ID from /remind list.').setRequired(true).setAutocomplete(true),
						),
				),
		);
	}

	public override async autocompleteRun(interaction: Subcommand.AutocompleteInteraction) {
		const focused = interaction.options.getFocused(true);
		if (focused.name === 'duration' || focused.name === 'every') {
			return interaction.respond(autocompleteDuration(focused.value));
		}
		if (focused.name === 'id') {
			const pending = await db.query.reminders.findMany({
				where: and(eq(schema.reminders.userId, interaction.user.id), eq(schema.reminders.done, false)),
				limit: 25,
			});
			const q = focused.value.toString();
			return interaction.respond(
				pending
					.filter((r) => !q || String(r.id).includes(q) || r.content.toLowerCase().includes(q.toLowerCase()))
					.slice(0, 25)
					.map((r) => ({
						name: `#${r.id} — ${r.content.slice(0, 80)}`.slice(0, 100),
						value: r.id,
					})),
			);
		}
		return interaction.respond([]);
	}

	public async runMe(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const durationStr = interaction.options.getString('duration', true);
		const content = interaction.options.getString('message', true);
		const everyStr = interaction.options.getString('every');

		const durationMs = parseDuration(durationStr);
		if (!durationMs) return interaction.editReply(errorReply(`Invalid duration. ${DURATION_HINT}`));
		if (durationMs > MAX_DURATION_MS) return interaction.editReply(errorReply('Max reminder time is 30 days.'));

		let intervalMs: number | undefined;
		if (everyStr) {
			const parsed = parseDuration(everyStr);
			if (!parsed) return interaction.editReply(errorReply(`Invalid repeat interval. ${DURATION_HINT}`));
			if (parsed < MIN_INTERVAL_MS) return interaction.editReply(errorReply('Minimum repeat interval is 5 minutes.'));
			intervalMs = parsed;
		}

		const remindAt = new Date(Date.now() + durationMs);
		const channelId = interaction.channelId;
		const guildId = interaction.guildId ?? undefined;

		const [idRow] = await db
			.insert(schema.reminders)
			.values({
				userId: interaction.user.id,
				channelId,
				guildId: guildId ?? null,
				content,
				remindAt,
				intervalMs: intervalMs ?? null,
			})
			.$returningId();
		const [row] = await db.select().from(schema.reminders).where(eq(schema.reminders.id, idRow.id)).limit(1);
		if (!row) return interaction.editReply(errorReply('Failed to create reminder.'));

		const recurNote = intervalMs ? ` Repeats every **${humanDuration(intervalMs)}**.` : '';
		return interaction.editReply(
			successReply(
				`Reminder set! I'll remind you in **${humanDuration(durationMs)}** (<t:${Math.floor(remindAt.getTime() / 1000)}:f>).${recurNote}\nID: \`${row.id}\``,
			),
		);
	}

	public async runList(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const pending = await db.query.reminders.findMany({
			where: and(eq(schema.reminders.userId, interaction.user.id), eq(schema.reminders.done, false)),
		});

		if (!pending.length) return interaction.editReply(errorReply('You have no pending reminders.'));

		const lines = pending.map((r) => {
			const recurTag = r.intervalMs ? ` 🔁 every ${humanDuration(r.intervalMs)}` : '';
			return `\`#${r.id}\` <t:${Math.floor(r.remindAt.getTime() / 1000)}:R>${recurTag} — ${r.content.slice(0, 80)}${r.content.length > 80 ? '…' : ''}`;
		});

		const container = new ContainerBuilder().setAccentColor(Colors.Info);
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### Your Reminders\n${lines.join('\n')}`));
		container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(`-# ${pending.length} pending • Use \`/remind delete <id>\` to cancel`),
		);

		return interaction.editReply({ components: [container], flags: (CV2_FLAG | MessageFlags.Ephemeral) as any });
	}

	public async runDelete(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const id = interaction.options.getInteger('id', true);
		const reminder = await db.query.reminders.findFirst({
			where: and(eq(schema.reminders.id, id), eq(schema.reminders.userId, interaction.user.id)),
		});
		if (!reminder) return interaction.editReply(errorReply(`No reminder \`#${id}\` found.`));
		if (reminder.done) return interaction.editReply(errorReply('That reminder has already fired.'));

		await db.delete(schema.reminders).where(eq(schema.reminders.id, id));
		return interaction.editReply(successReply(`Reminder \`#${id}\` deleted.`));
	}
}
