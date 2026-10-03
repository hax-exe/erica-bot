import { type Command, container } from '@sapphire/framework';
import { MessageFlags, TextDisplayBuilder } from 'discord.js';
import { Colors, CV2_FLAG, errorReply, hint, makeContainer, warningReply } from '../../components.js';
import { trackItemLines } from '../queueCard.js';

export class HistoryHandler {
	public async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const player = container.music.players.get(interaction.guildId);
		if (!player) return interaction.editReply(errorReply('Nothing is playing right now.'));

		const history = player.previous ?? [];
		if (history.length === 0) {
			return interaction.editReply(warningReply('No recently played tracks found.'));
		}

		const reversed = [...history].reverse();
		const cv2Container = makeContainer({ color: Colors.Info, header: 'Recently played' });
		cv2Container.addTextDisplayComponents(new TextDisplayBuilder().setContent(trackItemLines(reversed).join('\n')));
		cv2Container.addTextDisplayComponents(hint(`${history.length} track${history.length === 1 ? '' : 's'}`));

		// biome-ignore lint/suspicious/noExplicitAny: CV2 flag type gap
		return interaction.editReply({ components: [cv2Container], flags: CV2_FLAG } as any);
	}
}
