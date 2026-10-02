import { container } from '@sapphire/framework';
import type { Track } from 'moonlink.js';
import { pickBestTrack } from '../MusicManager.js';

const YOUTUBE_SOURCES = new Set(['youtube', 'youtubemusic', 'ytmusic']);

/** True when the track comes from YouTube / YouTube Music (by source name). */
export function isYouTubeTrack(track: { sourceName?: string | null } | null | undefined): boolean {
	return !!track?.sourceName && YOUTUBE_SOURCES.has(track.sourceName.toLowerCase());
}

export interface ResolveNamedTrackOptions {
	/**
	 * Skip the YouTube / YouTube Music attempts and reject YouTube-sourced
	 * results — used when a YouTube track already failed at playback.
	 */
	excludeYouTube?: boolean;
}

/**
 * Resolve text / Spotify metadata to a playable track.
 * Prefer YouTube Music with title+artist matching — never trust
 * NodeLink's wrong-source fallbacks when YouTube stream lookup fails.
 * Deezer and SoundCloud are tried last as non-YouTube fallbacks.
 */
export async function resolveNamedTrack(
	title: string,
	artist: string | null | undefined,
	requester: string,
	minScore = 0.45,
	options: ResolveNamedTrackOptions = {},
): Promise<Track | null> {
	const { music } = container;
	const q = artist ? `${artist} ${title}` : title;

	const youtubeAttempts: Array<{ query: string; source?: string }> = [
		{ query: q, source: 'youtubemusic' },
		{ query: `ytmsearch:${q}` },
		{ query: `ytsearch:${q}` },
	];
	const attempts: Array<{ query: string; source?: string }> = [
		...(options.excludeYouTube ? [] : youtubeAttempts),
		{ query: `dzsearch:${q}` },
		{ query: `scsearch:${q}` },
	];

	for (const attempt of attempts) {
		try {
			const result = await music.search({
				query: attempt.query,
				source: attempt.source,
				requester,
			});
			let tracks = (result?.tracks ?? []) as Track[];
			if (options.excludeYouTube) tracks = tracks.filter((t) => !isYouTubeTrack(t));
			if (!tracks.length) continue;
			const best = pickBestTrack(tracks.slice(0, 8), title, artist, minScore);
			if (best) return best;
		} catch {
			// try next source
		}
	}
	return null;
}
