import { type Command, container } from '@sapphire/framework';
import { MessageFlags, TextDisplayBuilder } from 'discord.js';
import { isAutoplayOn } from '../../AutoplayManager.js';
import { Colors, CV2_FLAG, errorReply, makeContainer, meta, separator } from '../../components.js';
import { formatDuration } from '../../MusicManager.js';

const PAGE_SIZE = 10;

export class QueueHandler {
	public async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const player = container.music.players.get(interaction.guildId);
		if (!player) return interaction.editReply(errorReply('Nothing is playing right now.'));

		const query = interaction.options.getString('query')?.toLowerCase();
		let tracks = player.queue.tracks ?? [];
		if (query) {
			tracks = tracks.filter((t) => t.title?.toLowerCase().includes(query) || t.author?.toLowerCase().includes(query));
		}

		const current = player.current;
		const totalPages = Math.max(1, Math.ceil(tracks.length / PAGE_SIZE));
		const page = Math.min(interaction.options.getInteger('page') ?? 1, totalPages);
		const start = (page - 1) * PAGE_SIZE;
		const slice = tracks.slice(start, start + PAGE_SIZE);

		const lines: string[] = [];

		if (current) {
			const currentMatches =
				!query || current.title?.toLowerCase().includes(query) || current.author?.toLowerCase().includes(query);
			if (currentMatches) {
				const dur = current.isStream ? 'LIVE' : formatDuration(current.duration ?? 0);
				const label = player.paused ? 'Paused' : 'Now Playing';
				lines.push(`**${label}**\n[${current.title}](${current.uri}) — \`${dur}\``);
			}
		}

		if (slice.length > 0) {
			lines.push('');
			const pageLabel = totalPages > 1 ? ` — page ${page} of ${totalPages}` : '';
			const sectionHeader = query ? `**Search results for "${query}"${pageLabel}**` : `**Up next${pageLabel}**`;
			lines.push(sectionHeader);
			for (const [i, t] of slice.entries()) {
				const dur = t.isStream ? 'LIVE' : formatDuration(t.duration ?? 0);
				lines.push(`\`${start + i + 1}.\` [${t.title}](${t.uri}) — \`${dur}\``);
			}
		} else if (lines.length === 0) {
			lines.push(query ? `No matching tracks found for "${query}".` : 'The queue is empty.');
		}

		const currentMatches =
			current &&
			(!query || current.title?.toLowerCase().includes(query) || current.author?.toLowerCase().includes(query));
		if (tracks.length > 0 || currentMatches) {
			const queueMs = tracks.reduce((acc, t) => acc + (t.duration ?? 0), 0);
			const currentMs =
				currentMatches && !current.isStream && current.duration ? current.duration - (current.position ?? 0) : 0;
			const totalMs = queueMs + currentMs;
			lines.push('');
			const countLabel = query
				? `${tracks.length} matching track${tracks.length === 1 ? '' : 's'}`
				: `${tracks.length} track${tracks.length === 1 ? '' : 's'} queued`;
			lines.push(meta(countLabel, `${formatDuration(totalMs)} remaining`));
		}

		const footerBits: string[] = [];
		if (player.loop === 'track') footerBits.push('Loop track');
		else if (player.loop === 'queue') footerBits.push('Loop queue');
		if (isAutoplayOn(interaction.guildId)) footerBits.push('Autoplay on');

		const cv2Container = makeContainer({ color: Colors.Info, header: 'Queue' });
		cv2Container.addSeparatorComponents(separator());
		cv2Container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
		if (footerBits.length) {
			cv2Container.addTextDisplayComponents(new TextDisplayBuilder().setContent(meta(...footerBits)));
		}

		// biome-ignore lint/suspicious/noExplicitAny: Discord.js CV2 flag type gap
		return interaction.editReply({ components: [cv2Container], flags: CV2_FLAG } as any);
	}
}
