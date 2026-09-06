import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import {
	type AutocompleteInteraction,
	type ContainerBuilder,
	MessageFlags,
	PermissionFlagsBits,
	TextDisplayBuilder,
} from 'discord.js';
import { and, eq } from 'drizzle-orm';
import { Colors, CV2_FLAG, errorReply, field, makeContainer, separator, successReply } from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';
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

function hasModerationPerms(interaction: Subcommand.ChatInputCommandInteraction): boolean {
	if (!interaction.memberPermissions) return false;
	const perms = BigInt(interaction.memberPermissions.bitfield);
	if ((perms & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator) return true;
	const modPerms =
		PermissionFlagsBits.ManageGuild |
		PermissionFlagsBits.KickMembers |
		PermissionFlagsBits.BanMembers |
		PermissionFlagsBits.ModerateMembers;
	return (perms & modPerms) !== 0n;
}

@ApplyOptions<Subcommand.Options>({
	name: 'tag',
	description: 'Send or manage server tags.',
	subcommands: [
		{ name: 'send', chatInputRun: 'chatInputSend' },
		{ name: 'create', chatInputRun: 'chatInputCreate' },
		{ name: 'edit', chatInputRun: 'chatInputEdit' },
		{ name: 'delete', chatInputRun: 'chatInputDelete' },
		{ name: 'list', chatInputRun: 'chatInputList' },
	],
})
export class TagCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('tag')
				.setDescription('Send or manage server tags.')
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
				// create
				.addSubcommand((sub) =>
					sub
						.setName('create')
						.setDescription('Create a new tag.')
						.addStringOption((o) =>
							o
								.setName('name')
								.setDescription('Tag name (unique per server, max 32 chars).')
								.setRequired(true)
								.setMaxLength(32),
						)
						.addStringOption((o) =>
							o
								.setName('content')
								.setDescription('Text content of the tag (max 2000 chars).')
								.setRequired(true)
								.setMaxLength(2000),
						)
						.addStringOption((o) =>
							o.setName('aliases').setDescription('Comma-separated aliases (e.g. "rules,tos").').setRequired(false),
						),
				)
				// edit
				.addSubcommand((sub) =>
					sub
						.setName('edit')
						.setDescription("Edit an existing tag's content.")
						.addStringOption((o) =>
							o.setName('name').setDescription('Tag name.').setRequired(true).setAutocomplete(true),
						)
						.addStringOption((o) =>
							o.setName('content').setDescription('New content (max 2000 chars).').setRequired(true).setMaxLength(2000),
						),
				)
				// delete
				.addSubcommand((sub) =>
					sub
						.setName('delete')
						.setDescription('Delete a tag.')
						.addStringOption((o) =>
							o.setName('name').setDescription('Tag name.').setRequired(true).setAutocomplete(true),
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

	// ── /tag create ─────────────────────────────────────────────────────────────

	public async chatInputCreate(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}
		if (!hasModerationPerms(interaction)) {
			return interaction.editReply(errorReply('You do not have permission to manage tags.'));
		}

		const name = interaction.options.getString('name', true).toLowerCase().trim();
		const content = interaction.options.getString('content', true);
		const aliasesRaw = interaction.options.getString('aliases');
		const aliases: string[] = aliasesRaw
			? aliasesRaw
					.split(',')
					.map((a) => a.trim().toLowerCase())
					.filter((a) => a.length > 0 && a.length <= 32)
			: [];

		// Check uniqueness
		const existing = await resolveTag(interaction.guildId, name);
		if (existing) {
			return interaction.editReply(errorReply(`Tag \`${name}\` already exists. Use \`/tag edit\` to update it.`));
		}

		await db.insert(schema.tags).values({
			guildId: interaction.guildId,
			name,
			aliases: JSON.stringify(aliases),
			content,
		});

		const aliasSuffix = aliases.length > 0 ? ` Aliases: ${aliases.map((a) => `\`${a}\``).join(', ')}.` : '';
		return interaction.editReply(successReply(`Tag \`${name}\` created.${aliasSuffix}`));
	}

	// ── /tag edit ───────────────────────────────────────────────────────────────

	public async chatInputEdit(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}
		if (!hasModerationPerms(interaction)) {
			return interaction.editReply(errorReply('You do not have permission to manage tags.'));
		}

		const name = interaction.options.getString('name', true).toLowerCase().trim();
		const content = interaction.options.getString('content', true);

		const existing = await resolveTag(interaction.guildId, name);
		if (!existing) {
			return interaction.editReply(errorReply(`Tag \`${name}\` not found.`));
		}

		await db
			.update(schema.tags)
			.set({ content })
			.where(and(eq(schema.tags.guildId, interaction.guildId), eq(schema.tags.name, existing.name)));

		return interaction.editReply(successReply(`Tag \`${existing.name}\` updated.`));
	}

	// ── /tag delete ─────────────────────────────────────────────────────────────

	public async chatInputDelete(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}
		if (!hasModerationPerms(interaction)) {
			return interaction.editReply(errorReply('You do not have permission to manage tags.'));
		}

		const name = interaction.options.getString('name', true).toLowerCase().trim();

		const existing = await resolveTag(interaction.guildId, name);
		if (!existing) {
			return interaction.editReply(errorReply(`Tag \`${name}\` not found.`));
		}

		await db
			.delete(schema.tags)
			.where(and(eq(schema.tags.guildId, interaction.guildId), eq(schema.tags.name, existing.name)));

		return interaction.editReply(successReply(`Tag \`${existing.name}\` deleted.`));
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
