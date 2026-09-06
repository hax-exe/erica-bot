import { type Command, container } from '@sapphire/framework';
import { MessageFlags } from 'discord.js';
import { isAutoplayOn } from '../../AutoplayManager.js';
import { Colors, CV2_FLAG, errorReply, musicTrackCard } from '../../components.js';
import { formatDuration } from '../../MusicManager.js';

export class NowPlayingHandler {
	public async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const player = container.music.players.get(interaction.guildId);
		if (!player?.current) return interaction.editReply(errorReply('Nothing is playing right now.'));

		const track = player.current;
		const duration = track.isStream ? 'LIVE' : formatDuration(track.duration ?? 0);
		const position = !track.isStream && track.duration != null ? formatDuration(track.position ?? 0) : null;
		const requester = track.userData?.requester ? `<@${track.userData.requester}>` : 'Unknown';

		const album = (track.pluginInfo as Record<string, unknown> | undefined)?.albumName as string | undefined;
		const loopMode = (player.loop as 'off' | 'track' | 'queue') ?? 'off';

		const card = musicTrackCard({
			header: player.paused ? 'Paused' : 'Now Playing',
			color: player.paused ? Colors.Warning : Colors.Voice,
			title: track.title ?? 'Unknown',
			uri: track.uri,
			author: track.author,
			album,
			requesterMention: requester,
			position,
			duration,
			autoPlay: isAutoplayOn(interaction.guildId),
			queueSize: player.queue.size,
			artworkUrl: track.artworkUrl,
			withControls: true,
			paused: player.paused,
			loopMode,
		});

		// biome-ignore lint/suspicious/noExplicitAny: Discord.js CV2 flag type gap
		return interaction.editReply({ components: [card], flags: CV2_FLAG } as any);
	}
}
