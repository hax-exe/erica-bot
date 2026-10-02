import { type Command, container } from '@sapphire/framework';
import { GuildMember } from 'discord.js';
import type { Track } from 'moonlink.js';
import { errorReply, successReply, warningReply } from '../../components.js';
import { formatDuration, inSameVC, saveMusicQueue, spotifySearch } from '../../MusicManager.js';
import { resolveNamedTrack } from '../resolveTrack.js';
import { searchSuggestions, type TrackSuggestion } from '../suggest.js';

const ALLOWED_HOSTS = new Set([
	'youtube.com',
	'www.youtube.com',
	'm.youtube.com',
	'music.youtube.com',
	'youtu.be',
	'soundcloud.com',
	'www.soundcloud.com',
	'open.spotify.com',
	'twitch.tv',
	'www.twitch.tv',
]);

function allowedUrl(query: string): { ok: true } | { ok: false; reason: string } {
	try {
		const host = new URL(query).hostname.toLowerCase();
		if (!ALLOWED_HOSTS.has(host)) {
			return {
				ok: false,
				reason: `Links from **${host}** are not supported. Use YouTube, SoundCloud, or Spotify.`,
			};
		}
		return { ok: true };
	} catch {
		return { ok: false, reason: 'Invalid URL.' };
	}
}

function isSpotifyUrl(query: string): boolean {
	try {
		return new URL(query).hostname.toLowerCase().includes('spotify.com');
	} catch {
		return false;
	}
}

function isStaleInteraction(err: unknown): boolean {
	if (typeof err !== 'object' || err === null) return false;
	const code = (err as { code?: unknown }).code;
	return code === 10062 || code === 10015 || code === 40060;
}

export class PlayHandler {
	public async autocompleteRun(interaction: Command.AutocompleteInteraction) {
		try {
			const focused = interaction.options.getFocused();
			if (!focused || focused.length < 2) return interaction.respond([]);
			if (/^https?:\/\//i.test(focused)) return interaction.respond([]);

			// Discord autocomplete must respond within ~3s — never wait on a slow suggestion call.
			const results = await Promise.race([
				searchSuggestions(focused, 8),
				new Promise<TrackSuggestion[]>((resolve) => setTimeout(() => resolve([]), 2_400)),
			]);

			return await interaction.respond(
				results.map((r) => ({
					name: `${r.title} — ${r.artist}${r.durationMs > 0 ? ` (${formatDuration(r.durationMs)})` : ''}`.slice(0, 100),
					value: `${r.title} ${r.artist}`.slice(0, 100),
				})),
			);
		} catch (err) {
			if (isStaleInteraction(err)) return;
			try {
				if (!interaction.responded) await interaction.respond([]);
			} catch {
				// already expired / acknowledged
			}
		}
	}

	public async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		// Defer publicly — queue feedback is visible; the Now Playing card comes from trackStart only
		try {
			await interaction.deferReply();
		} catch (err) {
			if (isStaleInteraction(err)) return;
			throw err;
		}

		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const member =
			interaction.member instanceof GuildMember
				? interaction.member
				: await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

		const vc = member?.voice.channel;
		if (!vc) return interaction.editReply(warningReply('Join a voice channel first.'));

		const { music } = container;

		const existingPlayer = music.players.get(interaction.guildId);
		if (existingPlayer && !inSameVC(existingPlayer.voiceChannelId, vc.id)) {
			return interaction.editReply(warningReply(`I'm already playing in <#${existingPlayer.voiceChannelId}>.`));
		}

		const query = interaction.options.getString('query', true);
		const isUrl = /^https?:\/\//i.test(query);

		// Validate and search before touching voice, so a bad query never leaves the bot idling in a channel.
		if (isUrl) {
			const check = allowedUrl(query);
			if (!check.ok) return interaction.editReply(errorReply(check.reason));
		}

		let result = await music.search({ query, requester: interaction.user.id });

		// Text queries / Spotify links: resolve by title+artist so we don't get
		// NodeLink's wrong-source fallbacks when YouTube stream lookup fails.
		if (!isUrl || isSpotifyUrl(query)) {
			let wantTitle: string | null = null;
			let wantArtist: string | null = null;

			if (!isUrl) {
				const sp = (await spotifySearch(query, 1))[0];
				if (sp) {
					wantTitle = sp.title;
					wantArtist = sp.artist;
				} else {
					wantTitle = query;
				}
			} else if (result.tracks[0]) {
				wantTitle = result.tracks[0].title ?? null;
				wantArtist = result.tracks[0].author ?? null;
			}

			if (wantTitle) {
				const matched = await resolveNamedTrack(wantTitle, wantArtist, interaction.user.id);
				if (matched) {
					result = {
						...result,
						loadType: 'track',
						tracks: [matched],
					} as typeof result;
				} else if (!isUrl) {
					// No confident match — don't queue a random first hit
					return interaction.editReply(
						errorReply(`Couldn't find a close match for **${wantTitle}**. Try a YouTube link or a more specific name.`),
					);
				}
			}
		}

		if (!result.tracks.length || result.loadType === 'empty' || result.loadType === 'error') {
			if (!isUrl) {
				result = await music.search({ query: `dzsearch:${query}`, requester: interaction.user.id });
			}
		}

		if (!result.tracks.length || result.loadType === 'empty' || result.loadType === 'error') {
			if (!isUrl) {
				const prev = result;
				result = await music.search({ query: `scsearch:${query}`, requester: interaction.user.id }).catch(() => prev);
			}
		}

		if (!result.tracks.length || result.loadType === 'empty' || result.loadType === 'error') {
			return interaction.editReply(
				errorReply(
					result.loadType === 'error'
						? "I couldn't search right now. Try again in a moment."
						: `No results for **${query}**. Try a different name or paste a YouTube link.`,
				),
			);
		}

		// Re-check after the search: another /play may have started a player in a different channel meanwhile.
		const playerBeforeCreate = music.players.get(interaction.guildId);
		if (playerBeforeCreate && !inSameVC(playerBeforeCreate.voiceChannelId, vc.id)) {
			return interaction.editReply(warningReply(`I'm already playing in <#${playerBeforeCreate.voiceChannelId}>.`));
		}

		// Moonlink native autoPlay stays off — Erica owns autoplay via AutoplayManager.
		const player = music.players.create({
			guildId: interaction.guildId,
			voiceChannelId: vc.id,
			textChannelId: interaction.channelId,
			autoPlay: false,
		});

		if (!player.connected) {
			try {
				await player.connect();
			} catch (err: unknown) {
				// Don't leave a freshly created, never-used player behind.
				if (!playerBeforeCreate && !player.current) await player.destroy().catch(() => null);
				return interaction.editReply(errorReply((err as Error).message));
			}
		}

		switch (result.loadType) {
			case 'playlist': {
				const wasPlaying = player.playing;
				player.queue.add(result.tracks);
				if (!wasPlaying) await player.play();
				await saveMusicQueue(player);
				const totalMs = result.tracks.reduce((a: number, t: Track) => a + (t.duration ?? 0), 0);
				const name = result.playlistInfo?.name ?? 'playlist';
				return interaction.editReply(
					successReply(
						wasPlaying
							? `Queued **${name}** — ${result.tracks.length} tracks · ${formatDuration(totalMs)}`
							: `Playing **${name}** — ${result.tracks.length} tracks · ${formatDuration(totalMs)}`,
						false,
					),
				);
			}
			case 'search':
			case 'track': {
				const track = result.tracks[0];
				const wasPlaying = player.playing;
				player.queue.add(track);
				if (!wasPlaying) await player.play();
				await saveMusicQueue(player);
				const title = track.title ?? 'Unknown';
				const artist = track.author ? ` — ${track.author}` : '';
				if (wasPlaying) {
					const queuePos = player.queue.size;
					return interaction.editReply(successReply(`Queued **${title}**${artist} · Position **#${queuePos}**`, false));
				}
				return interaction.editReply(successReply(`Playing **${title}**${artist}`, false));
			}
			default:
				return interaction.editReply(errorReply('Something went wrong loading that track. Please try again.'));
		}
	}
}
