import { type Command, container } from '@sapphire/framework';
import { MessageFlags, TextDisplayBuilder } from 'discord.js';
import { Colors, CV2_FLAG, errorReply, makeContainer, separator } from '../../components.js';
import { formatDuration, spotifySearch } from '../../MusicManager.js';

interface LyricsLine {
	timestamp: number;
	line: string;
}

interface LyricsResponse {
	loadType: string;
	data?: {
		name?: string;
		lines?: LyricsLine[];
	};
}

function isStaleInteraction(err: unknown): boolean {
	if (typeof err !== 'object' || err === null) return false;
	const code = (err as { code?: unknown }).code;
	return code === 10062 || code === 10015 || code === 40060;
}

export class LyricsHandler {
	public async autocompleteRun(interaction: Command.AutocompleteInteraction) {
		try {
			const focused = interaction.options.getFocused();
			if (!focused || focused.length < 2) return interaction.respond([]);
			if (/^https?:\/\//i.test(focused)) return interaction.respond([]);

			const results = await Promise.race([
				spotifySearch(focused, 8),
				new Promise<Awaited<ReturnType<typeof spotifySearch>>>((resolve) => setTimeout(() => resolve([]), 2_400)),
			]);

			return await interaction.respond(
				results.map((r) => ({
					name: `${r.title} — ${r.artist} (${formatDuration(r.durationMs)})`.slice(0, 100),
					value: r.url,
				})),
			);
		} catch (err) {
			if (isStaleInteraction(err)) return;
			try {
				if (!interaction.responded) await interaction.respond([]);
			} catch {
				// expired / acknowledged
			}
		}
	}

	public async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const player = container.music.players.get(interaction.guildId);
		const query = interaction.options.getString('query');

		let track: any = player?.current;

		if (query) {
			const { music } = container;
			const isUrl = /^https?:\/\//i.test(query);
			let searchQuery = query;
			if (!isUrl) {
				const results = await spotifySearch(query, 1);
				searchQuery = results[0]?.url ?? `ytsearch:${query}`;
			}
			const result = await music.search({ query: searchQuery, requester: interaction.user.id });
			const found = result?.tracks?.[0];
			if (!found) return interaction.editReply(errorReply(`No track found for **${query}**.`));
			track = found;
		}

		if (!track) return interaction.editReply(errorReply('Nothing is playing right now.'));

		const encoded = track.encoded;
		if (!encoded) return interaction.editReply(errorReply('Could not retrieve track info.'));

		const secure = process.env.LAVALINK_SECURE === 'true';
		const host = process.env.LAVALINK_HOST ?? 'localhost';
		// NodeLink default port (Lavalink classic is 2333)
		const port = process.env.LAVALINK_PORT ?? '3000';
		const password = process.env.LAVALINK_PASSWORD ?? 'youshallnotpass';
		const baseUrl = `http${secure ? 's' : ''}://${host}:${port}`;

		let lyricsData: LyricsResponse;
		try {
			const res = await fetch(`${baseUrl}/v4/lyrics?encodedTrack=${encodeURIComponent(encoded)}&language=en`, {
				headers: { Authorization: password },
			});
			if (!res.ok) return interaction.editReply(errorReply('No lyrics found for this track.'));
			lyricsData = (await res.json()) as LyricsResponse;
		} catch {
			return interaction.editReply(errorReply('Failed to fetch lyrics. Try again later.'));
		}

		if (lyricsData.loadType !== 'lyricLoaded' || !lyricsData.data?.lines?.length) {
			return interaction.editReply(errorReply('No lyrics found for this track.'));
		}

		const lines = lyricsData.data.lines;
		let lyricsText = lines
			.map((l) => l.line)
			.filter((l) => l.trim())
			.join('\n');

		if (lyricsText.length > 1900) {
			lyricsText = `${lyricsText.slice(0, 1897)}...`;
		}

		const sourceName = lyricsData.data.name ?? 'Unknown';
		const trackTitle = track.title ?? 'Unknown';

		const cv2Container = makeContainer({ color: Colors.Info });
		cv2Container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### Lyrics — ${trackTitle}`));
		cv2Container.addSeparatorComponents(separator());
		cv2Container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lyricsText));
		cv2Container.addSeparatorComponents(separator());
		cv2Container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Source: ${sourceName}`));

		// biome-ignore lint/suspicious/noExplicitAny: Discord.js CV2 flag type gap
		return interaction.editReply({ components: [cv2Container], flags: (CV2_FLAG | MessageFlags.Ephemeral) as any });
	}
}
