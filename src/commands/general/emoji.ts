import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { MessageFlags } from 'discord.js';
import { successReply, warningReply } from '../../lib/components.js';
import { parseCustomEmoji } from '../../lib/EmojiUtil.js';

@ApplyOptions<Subcommand.Options>({
	name: 'emoji',
	description: 'Emoji utilities.',
	subcommands: [{ name: 'enlarge', chatInputRun: 'chatInputEnlarge' }],
})
export class EmojiCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('emoji')
				.setDescription('Emoji utilities.')
				.addSubcommand((sub) =>
					sub
						.setName('enlarge')
						.setDescription('Show a large version of a custom emoji.')
						.addStringOption((o) => o.setName('emoji').setDescription('Paste a custom emoji.').setRequired(true)),
				),
		);
	}

	public async chatInputEnlarge(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const parsed = parseCustomEmoji(interaction.options.getString('emoji', true));
		if (!parsed) {
			return interaction.editReply(warningReply('Paste a **custom** emoji like `<:name:id>`.'));
		}
		const ext = parsed.animated ? 'gif' : 'png';
		const url = `https://cdn.discordapp.com/emojis/${parsed.id}.${ext}?size=256&quality=lossless`;
		return interaction.editReply(successReply(`**:${parsed.name}:**\n${url}`));
	}
}
