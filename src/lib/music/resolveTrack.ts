import { container } from '@sapphire/framework';
import type { Track } from 'moonlink.js';
import { pickBestTrack } from '../MusicManager.js';

/**
 * Resolve text / Spotify metadata to a playable track.
 * Prefer YouTube Music with title+artist matching — never trust
 * NodeLink's wrong-source fallbacks when YouTube stream lookup fails.
 */
export async function resolveNamedTrack(
	title: string,
	artist: string | null | undefined,
	requester: string,
	minScore = 0.45,
): Promise<Track | null> {
	const { music } = container;
	const q = artist ? `${artist} ${title}` : title;

	const attempts: Array<{ query: string; source?: string }> = [
		{ query: q, source: 'youtubemusic' },
		{ query: `ytmsearch:${q}` },
		{ query: `ytsearch:${q}` },
		{ query: `dzsearch:${q}` },
	];

	for (const attempt of attempts) {
		try {
			const result = await music.search({
				query: attempt.query,
				source: attempt.source,
				requester,
			});
			const tracks = (result?.tracks ?? []) as Track[];
			if (!tracks.length) continue;
			const best = pickBestTrack(tracks.slice(0, 8), title, artist, minScore);
			if (best) return best;
		} catch {
			// try next source
		}
	}
	return null;
}
