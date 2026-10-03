import { type Command, container } from '@sapphire/framework';
import { MessageFlags } from 'discord.js';
import { isAutoplayOn } from '../../AutoplayManager.js';
import { CV2_FLAG, errorReply } from '../../components.js';
import { buildQueueCard } from '../queueCard.js';

const PAGE_SIZE = 10;

export class QueueHandler {
	public async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const player = container.music.players.get(interaction.guildId);
		if (!player) return interaction.editReply(errorReply('Nothing is playing right now.'));

		const rawQuery = interaction.options.getString('query');
		const query = rawQuery?.toLowerCase();
		let tracks = player.queue.tracks ?? [];
		if (query) {
			tracks = tracks.filter((t) => t.title?.toLowerCase().includes(query) || t.author?.toLowerCase().includes(query));
		}

		const current = player.current;
		const currentMatches =
			!!current &&
			(!query || current.title?.toLowerCase().includes(query) || current.author?.toLowerCase().includes(query));
		const totalPages = Math.max(1, Math.ceil(tracks.length / PAGE_SIZE));
		const page = Math.min(interaction.options.getInteger('page') ?? 1, totalPages);

		const card = buildQueueCard({
			current: currentMatches ? current : null,
			paused: player.paused,
			tracks,
			page: Math.max(0, page - 1),
			pageSize: PAGE_SIZE,
			query: rawQuery?.trim() || null,
			loopMode: player.loop,
			autoPlay: isAutoplayOn(interaction.guildId),
		});

		// biome-ignore lint/suspicious/noExplicitAny: Discord.js CV2 flag type gap
		return interaction.editReply({ components: [card], flags: CV2_FLAG } as any);
	}
}
