import type { Command } from '@sapphire/framework';
import { MessageFlags, type TextChannel } from 'discord.js';
import { CV2_FLAG, errorReply, successReply } from '../../../lib/components.js';
import { buildVerificationPanel } from '../../../lib/VerificationUtil.js';

export class VerificationHandler {
	public async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Guild only.'));

		const channel = (interaction.options.getChannel('channel') ?? interaction.channel) as TextChannel | null;
		if (!channel?.isTextBased()) {
			return interaction.editReply(errorReply('Could not resolve a text channel.'));
		}

		const { container, row } = buildVerificationPanel();
		await channel.send({ components: [container, row], flags: CV2_FLAG });

		return interaction.editReply(successReply(`Verification panel posted in <#${channel.id}>.`));
	}
}
