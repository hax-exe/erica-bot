import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { type AutocompleteInteraction, type ContainerBuilder, MessageFlags, TextDisplayBuilder } from 'discord.js';
import { Colors, CV2_FLAG, errorReply, field, makeContainer, separator } from '../../lib/components.js';
import { getTagChoices, resolveTag, type TagData } from '../../lib/TagManager.js';

/** Build a CV2 container from a tag definition. */
function buildTagContainer(tag: TagData): ContainerBuilder {
	const hasEmbed = Boolean(tag.embed);
	const color = tag.embed?.color ?? Colors.Info;
	const header = tag.embed?.title ?? tag.name;

	const container = makeContainer({ color, header });

	if (tag.content) {
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(tag.content));
	}

	if (hasEmbed && tag.embed) {
		const embed = tag.embed;

		if (embed.description) {
			if (tag.content) container.addSeparatorComponents(separator());
			container.addTextDisplayComponents(new TextDisplayBuilder().setContent(embed.description));
		}

		if (embed.fields && embed.fields.length > 0) {
			container.addSeparatorComponents(separator());
			for (const f of embed.fields) {
				container.addTextDisplayComponents(new TextDisplayBuilder().setContent(field(f.name, f.value)));
			}
		}

		if (embed.footer) {
			container.addSeparatorComponents(separator());
			container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${embed.footer}`));
		}
	}

	return container;
}

@ApplyOptions<Subcommand.Options>({
	name: 'tag',
	description: 'Send or list server tags.',
	subcommands: [
		{ name: 'send', chatInputRun: 'chatInputSend' },
		{ name: 'list', chatInputRun: 'chatInputList' },
	],
})
export class TagCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('tag')
				.setDescription('Send or list server tags.')
				// send
				.addSubcommand((sub) =>
					sub
						.setName('send')
						.setDescription('Send a pre-configured tag.')
						.addStringOption((o) =>
							o.setName('name').setDescription('Tag name or alias.').setRequired(true).setAutocomplete(true),
						)
						.addUserOption((o) =>
							o.setName('mention').setDescription('Optionally mention a user alongside the tag.').setRequired(false),
						),
				)
				// list
				.addSubcommand((sub) => sub.setName('list').setDescription('List all tags in this server.')),
		);
	}

	public override async autocompleteRun(interaction: AutocompleteInteraction) {
		if (!interaction.inGuild()) return interaction.respond([]);
		const focused = interaction.options.getFocused();
		const choices = await getTagChoices(interaction.guildId, focused);
		return interaction.respond(choices);
	}

	// ── /tag send ───────────────────────────────────────────────────────────────

	public async chatInputSend(interaction: Subcommand.ChatInputCommandInteraction) {
		if (!interaction.inGuild()) {
			return interaction.reply(errorReply('This command can only be used in a server.') as any);
		}
		const name = interaction.options.getString('name', true);
		const mention = interaction.options.getUser('mention');

		const tag = await resolveTag(interaction.guildId, name);
		if (!tag) return interaction.reply(errorReply(`Tag \`${name}\` not found.`) as any);

		const container = buildTagContainer(tag);

		// If a user mention is requested, prepend a TextDisplay inside the same container
		if (mention) {
			const mentionContainer = makeContainer({ color: container.data.accent_color as number | undefined });
			mentionContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${mention}`));
			mentionContainer.addSeparatorComponents(separator());
			for (const comp of container.components ?? []) {
				(mentionContainer as any).components.push(comp);
			}
			return interaction.reply({ components: [mentionContainer], flags: CV2_FLAG });
		}

		return interaction.reply({ components: [container], flags: CV2_FLAG });
	}

	// ── /tag list ───────────────────────────────────────────────────────────────

	public async chatInputList(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}

		const { buildTagsPage } = await import('../../listeners/paginationInteractions.js');
		const payload = await buildTagsPage(interaction.guildId, 0);
		return interaction.editReply(payload as any);
	}
}
