import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { type AutocompleteInteraction, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { and, eq } from 'drizzle-orm';
import { errorReply, successReply } from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';
import { getTagChoices, resolveTag } from '../../lib/TagManager.js';

function hasModerationPerms(interaction: Subcommand.ChatInputCommandInteraction): boolean {
	if (!interaction.memberPermissions) return false;
	const perms = BigInt(interaction.memberPermissions.bitfield);
	if ((perms & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator) return true;
	return (perms & PermissionFlagsBits.ManageGuild) !== 0n;
}

/**
 * Staff tag management. Split out of `/tag` so the whole command can carry a
 * ManageGuild default permission (Discord can't hide individual subcommands).
 * The runtime moderator check stays as defence in depth — server admins can
 * override command visibility in Integrations settings.
 */
@ApplyOptions<Subcommand.Options>({
	name: 'tagadmin',
	description: 'Create, edit, or delete server tags (Staff only).',
	subcommands: [
		{ name: 'create', chatInputRun: 'chatInputCreate' },
		{ name: 'edit', chatInputRun: 'chatInputEdit' },
		{ name: 'delete', chatInputRun: 'chatInputDelete' },
	],
})
export class TagAdminCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('tagadmin')
				.setDescription('Create, edit, or delete server tags (Staff only).')
				.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
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
				),
		);
	}

	public override async autocompleteRun(interaction: AutocompleteInteraction) {
		if (!interaction.inGuild()) return interaction.respond([]);
		const focused = interaction.options.getFocused();
		const choices = await getTagChoices(interaction.guildId, focused);
		return interaction.respond(choices);
	}

	/** Deferred + in guild + moderator. Returns the guild ID, or null after replying with an error. */
	private async guard(interaction: Subcommand.ChatInputCommandInteraction): Promise<string | null> {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) {
			await interaction.editReply(errorReply('This command can only be used in a server.'));
			return null;
		}
		if (!hasModerationPerms(interaction)) {
			await interaction.editReply(errorReply('You do not have permission to manage tags.'));
			return null;
		}
		return interaction.guildId;
	}

	// ── /tagadmin create ────────────────────────────────────────────────────────

	public async chatInputCreate(interaction: Subcommand.ChatInputCommandInteraction) {
		const guildId = await this.guard(interaction);
		if (!guildId) return;

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
		const existing = await resolveTag(guildId, name);
		if (existing) {
			return interaction.editReply(errorReply(`Tag \`${name}\` already exists. Use \`/tagadmin edit\` to update it.`));
		}

		await db.insert(schema.tags).values({
			guildId,
			name,
			aliases: JSON.stringify(aliases),
			content,
		});

		const aliasSuffix = aliases.length > 0 ? ` Aliases: ${aliases.map((a) => `\`${a}\``).join(', ')}.` : '';
		return interaction.editReply(successReply(`Tag \`${name}\` created.${aliasSuffix}`));
	}

	// ── /tagadmin edit ──────────────────────────────────────────────────────────

	public async chatInputEdit(interaction: Subcommand.ChatInputCommandInteraction) {
		const guildId = await this.guard(interaction);
		if (!guildId) return;

		const name = interaction.options.getString('name', true).toLowerCase().trim();
		const content = interaction.options.getString('content', true);

		const existing = await resolveTag(guildId, name);
		if (!existing) {
			return interaction.editReply(errorReply(`Tag \`${name}\` not found.`));
		}

		await db
			.update(schema.tags)
			.set({ content })
			.where(and(eq(schema.tags.guildId, guildId), eq(schema.tags.name, existing.name)));

		return interaction.editReply(successReply(`Tag \`${existing.name}\` updated.`));
	}

	// ── /tagadmin delete ────────────────────────────────────────────────────────

	public async chatInputDelete(interaction: Subcommand.ChatInputCommandInteraction) {
		const guildId = await this.guard(interaction);
		if (!guildId) return;

		const name = interaction.options.getString('name', true).toLowerCase().trim();

		const existing = await resolveTag(guildId, name);
		if (!existing) {
			return interaction.editReply(errorReply(`Tag \`${name}\` not found.`));
		}

		await db.delete(schema.tags).where(and(eq(schema.tags.guildId, guildId), eq(schema.tags.name, existing.name)));

		return interaction.editReply(successReply(`Tag \`${existing.name}\` deleted.`));
	}
}
