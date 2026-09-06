import { type Command, container } from '@sapphire/framework';
import { MessageFlags, TextDisplayBuilder } from 'discord.js';
import { Colors, CV2_FLAG, errorReply, makeContainer, separator, warningReply } from '../../components.js';
import { formatDuration } from '../../MusicManager.js';

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
		const lines = reversed.map((t, idx) => {
			const dur = t.isStream ? '🔴 LIVE' : formatDuration(t.duration ?? 0);
			return `\`${idx + 1}.\` [${t.title}](${t.uri}) — \`${dur}\``;
		});

		const cv2Container = makeContainer({
			color: Colors.Info,
			header: `Recently Played (${history.length})`,
		});
		cv2Container.addSeparatorComponents(separator());
		cv2Container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));

		// biome-ignore lint/suspicious/noExplicitAny: CV2 flag type gap
		return interaction.editReply({ components: [cv2Container], flags: CV2_FLAG } as any);
	}
}
