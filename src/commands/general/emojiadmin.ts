import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { errorReply, successReply } from '../../lib/components.js';
import { parseCustomEmoji } from '../../lib/EmojiUtil.js';

/**
 * Staff emoji tools. Split out of `/emoji` so the whole command can carry a
 * ManageGuildExpressions default permission (Discord can't hide individual
 * subcommands). The runtime permission check stays as defence in depth.
 */
@ApplyOptions<Subcommand.Options>({
	name: 'emojiadmin',
	description: 'Manage server emojis (Staff only).',
	subcommands: [{ name: 'steal', chatInputRun: 'chatInputSteal' }],
})
export class EmojiAdminCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('emojiadmin')
				.setDescription('Manage server emojis (Staff only).')
				.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuildExpressions)
				.addSubcommand((sub) =>
					sub
						.setName('steal')
						.setDescription('Add a custom emoji from another server to this server.')
						.addStringOption((o) => o.setName('emoji').setDescription('Paste a custom emoji.').setRequired(true))
						.addStringOption((o) =>
							o.setName('name').setDescription('Optional new name (2–32 chars).').setRequired(false),
						),
				),
		);
	}

	public async chatInputSteal(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuildExpressions)) {
			return interaction.editReply(errorReply('You need **Manage Expressions** to steal emojis.'));
		}
		const me = interaction.guild.members.me;
		if (!me?.permissions.has(PermissionFlagsBits.ManageGuildExpressions)) {
			return interaction.editReply(errorReply('I need **Manage Expressions** in this server.'));
		}

		const parsed = parseCustomEmoji(interaction.options.getString('emoji', true));
		if (!parsed) {
			return interaction.editReply(errorReply('Paste a **custom** emoji like `<:name:id>`.'));
		}

		const nameOpt = interaction.options.getString('name')?.trim();
		const name = (nameOpt || parsed.name).replace(/[^\w]/g, '_').slice(0, 32);
		if (name.length < 2) return interaction.editReply(errorReply('Emoji name must be at least 2 characters.'));

		const ext = parsed.animated ? 'gif' : 'png';
		const url = `https://cdn.discordapp.com/emojis/${parsed.id}.${ext}?size=128&quality=lossless`;

		try {
			const emoji = await interaction.guild.emojis.create({ attachment: url, name });
			return interaction.editReply(successReply(`Added ${emoji} as \`:${emoji.name}:\` (\`${emoji.id}\`).`));
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'Failed to create emoji.';
			return interaction.editReply(errorReply(`Could not add emoji — ${msg}`));
		}
	}
}
