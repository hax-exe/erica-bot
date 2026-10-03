import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { escapeMarkdown, MessageFlags, TextDisplayBuilder } from 'discord.js';
import {
	Colors,
	chips,
	cv2Reply,
	errorReply,
	hint,
	makeContainer,
	successReply,
	warningReply,
} from '../../lib/components.js';
import {
	addHighlight,
	clearHighlights,
	isValidKeywordLength,
	listHighlights,
	MAX_HIGHLIGHTS_PER_MEMBER,
	MAX_KEYWORD_LENGTH,
	MEMBER_DM_BUDGET,
	MEMBER_DM_WINDOW_MS,
	MIN_KEYWORD_LENGTH,
	NOTIFY_COOLDOWN_MS,
	normalizeKeyword,
	removeHighlight,
} from '../../lib/HighlightUtil.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';

@ApplyOptions<Subcommand.Options>({
	name: 'highlight',
	description: 'Get a DM when a keyword is mentioned in this server.',
	subcommands: [
		{ name: 'add', chatInputRun: 'runAdd' },
		{ name: 'remove', chatInputRun: 'runRemove' },
		{ name: 'list', chatInputRun: 'runList' },
		{ name: 'clear', chatInputRun: 'runClear' },
	],
})
export class HighlightCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('highlight')
				.setDescription('Get a DM when a keyword is mentioned in this server.')
				.addSubcommand((sub) =>
					sub
						.setName('add')
						.setDescription('Get a DM when this word is mentioned.')
						.addStringOption((o) =>
							o
								.setName('keyword')
								.setDescription(
									`The word or phrase to watch for (${MIN_KEYWORD_LENGTH}-${MAX_KEYWORD_LENGTH} characters).`,
								)
								.setRequired(true)
								.setMinLength(MIN_KEYWORD_LENGTH)
								.setMaxLength(MAX_KEYWORD_LENGTH),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('remove')
						.setDescription('Stop watching for a keyword.')
						.addStringOption((o) =>
							o
								.setName('keyword')
								.setDescription('One of your highlight keywords.')
								.setRequired(true)
								.setMaxLength(MAX_KEYWORD_LENGTH)
								.setAutocomplete(true),
						),
				)
				.addSubcommand((sub) => sub.setName('list').setDescription('Show your highlight keywords in this server.'))
				.addSubcommand((sub) =>
					sub.setName('clear').setDescription('Remove all your highlight keywords in this server.'),
				),
		);
	}

	public override async autocompleteRun(interaction: Subcommand.AutocompleteInteraction) {
		try {
			const focused = interaction.options.getFocused(true);
			if (!interaction.guildId || focused.name !== 'keyword') return await interaction.respond([]);

			const query = normalizeKeyword(String(focused.value));
			const own = await listHighlights(interaction.guildId, interaction.user.id);
			return await interaction.respond(
				own
					.filter((keyword) => !query || keyword.includes(query))
					.slice(0, 25)
					.map((keyword) => ({ name: keyword, value: keyword })),
			);
		} catch {
			// 10062 / 40060 — stale interaction; a failed lookup just shows no suggestions
		}
	}

	/** Defer, then make sure this is a server with the Highlights module on. Returns the guild ID, or null after replying. */
	private async prepare(interaction: Subcommand.ChatInputCommandInteraction): Promise<string | null> {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inGuild()) {
			await interaction.editReply(errorReply('Server only.'));
			return null;
		}
		if (!(await isModuleEnabled(interaction.guildId, 'highlights'))) {
			await interaction.editReply(
				errorReply(
					'The Highlights module is disabled on this server. A server admin can turn it on with `/module enable`.',
				),
			);
			return null;
		}
		return interaction.guildId;
	}

	public async runAdd(interaction: Subcommand.ChatInputCommandInteraction) {
		const guildId = await this.prepare(interaction);
		if (!guildId) return;

		const keyword = normalizeKeyword(interaction.options.getString('keyword', true));
		if (!isValidKeywordLength(keyword)) {
			return interaction.editReply(
				errorReply(`A keyword must be ${MIN_KEYWORD_LENGTH}-${MAX_KEYWORD_LENGTH} characters long.`),
			);
		}

		const result = await addHighlight(guildId, interaction.user.id, keyword);
		if (!result.ok) {
			return interaction.editReply(
				errorReply(
					result.reason === 'duplicate'
						? `You already highlight **${escapeMarkdown(keyword)}**.`
						: `You can have at most ${MAX_HIGHLIGHTS_PER_MEMBER} highlights in this server. Remove one with \`/highlight remove\` first.`,
				),
			);
		}

		return interaction.editReply(
			successReply(
				`Highlight added\nI'll DM you when **${escapeMarkdown(keyword)}** is mentioned in a channel you can read.\n-# Your DMs from this server must be open, otherwise I can't reach you. Limits: one DM per channel every ${NOTIFY_COOLDOWN_MS / 60_000} minutes, at most ${MEMBER_DM_BUDGET} highlight DMs every ${MEMBER_DM_WINDOW_MS / 60_000} minutes.`,
			),
		);
	}

	public async runRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		const guildId = await this.prepare(interaction);
		if (!guildId) return;

		const keyword = normalizeKeyword(interaction.options.getString('keyword', true));
		const removed = await removeHighlight(guildId, interaction.user.id, keyword);
		return interaction.editReply(
			removed
				? successReply(`Removed the highlight **${escapeMarkdown(keyword)}**.`)
				: errorReply(`You don't have a highlight for **${escapeMarkdown(keyword)}**.`),
		);
	}

	public async runList(interaction: Subcommand.ChatInputCommandInteraction) {
		const guildId = await this.prepare(interaction);
		if (!guildId) return;

		const keywords = await listHighlights(guildId, interaction.user.id);
		if (!keywords.length) {
			return interaction.editReply(
				warningReply('You have no highlights in this server. Add one with `/highlight add`.'),
			);
		}

		const container = makeContainer({ color: Colors.Info, header: 'Your highlights' });
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(chips(keywords)),
			hint(`${keywords.length} of ${MAX_HIGHLIGHTS_PER_MEMBER} used · add more with \`/highlight add\``),
		);
		return interaction.editReply(cv2Reply(container, true));
	}

	public async runClear(interaction: Subcommand.ChatInputCommandInteraction) {
		const guildId = await this.prepare(interaction);
		if (!guildId) return;

		const removed = await clearHighlights(guildId, interaction.user.id);
		return interaction.editReply(
			removed
				? successReply(`Removed ${removed} highlight${removed === 1 ? '' : 's'}.`)
				: warningReply('You have no highlights in this server.'),
		);
	}
}
