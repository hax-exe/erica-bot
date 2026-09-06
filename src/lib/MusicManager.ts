import { container } from '@sapphire/framework';
import type { Client } from 'discord.js';
import { eq } from 'drizzle-orm';
import { Manager, type Player } from 'moonlink.js';
import { db, schema } from './database.js';

// ---------------------------------------------------------------------------
// Spotify client-credentials token cache
// ---------------------------------------------------------------------------
let _spotifyToken: string | null = null;
let _spotifyTokenExpiry = 0;

async function getSpotifyToken(): Promise<string | null> {
	const clientId = process.env.SPOTIFY_CLIENT_ID;
	const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
	if (!clientId || !clientSecret) return null;
	if (_spotifyToken && Date.now() < _spotifyTokenExpiry) return _spotifyToken;

	const creds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
	const res = await fetch('https://accounts.spotify.com/api/token', {
		method: 'POST',
		headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
		body: 'grant_type=client_credentials',
	});
	if (!res.ok) return null;
	const json = (await res.json()) as { access_token: string; expires_in: number };
	_spotifyToken = json.access_token;
	_spotifyTokenExpiry = Date.now() + (json.expires_in - 60) * 1000;
	return _spotifyToken;
}

export interface SpotifyTrackResult {
	url: string;
	title: string;
	artist: string;
	durationMs: number;
	artworkUrl: string | null;
	album: string | null;
}

type SpotifyApiTrack = {
	id?: string;
	external_urls?: { spotify?: string };
	name?: string;
	artists?: Array<{ id?: string; name?: string }>;
	duration_ms?: number;
	album?: { name?: string; images?: Array<{ url?: string }> };
};

function mapSpotifyTrack(t: SpotifyApiTrack): SpotifyTrackResult | null {
	const url = t.external_urls?.spotify;
	if (!url) return null;
	return {
		url,
		title: t.name ?? 'Unknown',
		artist: t.artists?.[0]?.name ?? 'Unknown',
		durationMs: t.duration_ms ?? 0,
		artworkUrl: t.album?.images?.[0]?.url ?? null,
		album: t.album?.name ?? null,
	};
}

/**
 * Search Spotify for a plain-text query and return up to 10 tracks.
 * Returns an empty array if credentials are missing or no results found.
 */
export async function spotifySearch(query: string, limit = 10): Promise<SpotifyTrackResult[]> {
	const token = await getSpotifyToken();
	if (!token) return [];

	const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=${limit}`;
	const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
	if (!res.ok) return [];

	const json = (await res.json()) as { tracks?: { items?: SpotifyApiTrack[] } };
	return (json.tracks?.items ?? []).map(mapSpotifyTrack).filter((t): t is SpotifyTrackResult => t !== null);
}

/** Best-effort Spotify metadata lookup for a known title (+ optional artist). */
export async function spotifyLookupTrack(title: string, artist?: string | null): Promise<SpotifyTrackResult | null> {
	const q = artist ? `track:${title} artist:${artist}` : `track:${title}`;
	const hits = await spotifySearch(q, 3);
	if (!hits.length) {
		// Fallback: looser free-text search
		return (await spotifySearch(artist ? `${artist} ${title}` : title, 1))[0] ?? null;
	}
	return pickBestTrack(hits, title, artist) ?? hits[0] ?? null;
}

declare module '@sapphire/framework' {
	interface Container {
		music: Manager;
	}
}

export function createMusicManager(): Manager {
	return new Manager({
		nodes: [
			{
				host: process.env.LAVALINK_HOST ?? 'localhost',
				// NodeLink default port (Lavalink classic is 2333)
				port: Number(process.env.LAVALINK_PORT ?? 3000),
				password: process.env.LAVALINK_PASSWORD ?? 'youshallnotpass',
				secure: process.env.LAVALINK_SECURE === 'true',
				identifier: 'main',
			},
		],
		options: {
			clientName: 'Erica/1.0.0',
			trackHandling: {
				autoSkipOnError: true,
				skipStuckTracks: true,
				// Retries stampede NodeLink while YouTube SABR is backing off → HTTP 500 storms
				retryFailedTracks: false,
				maxRetryAttempts: 0,
			},
			playerDestruction: {
				autoDestroyOnIdle: true,
				idleTimeout: 300_000, // 5 minutes
			},
		},
	});
}

/** Format milliseconds as M:SS or H:MM:SS */
export function formatDuration(ms: number): string {
	const s = Math.floor((ms / 1000) % 60);
	const m = Math.floor((ms / 60_000) % 60);
	const h = Math.floor(ms / 3_600_000);
	const pad = (n: number) => String(n).padStart(2, '0');
	return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Normalize titles for fuzzy match (strip featured artists, remaster tags, punctuation). */
export function normalizeTrackText(text: string): string {
	return text
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
		.replace(/\b(official|audio|video|lyrics|lyric|visuali[sz]er|remaster(?:ed)?|hd|hq|mv|ft\.?|feat\.?|with)\b/g, ' ')
		.replace(/[^a-z0-9\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function tokenSet(text: string): Set<string> {
	return new Set(
		normalizeTrackText(text)
			.split(' ')
			.filter((t) => t.length > 1),
	);
}

/** 0–1 similarity between expected metadata and a candidate track. */
export function trackMatchScore(
	track: { title?: string | null; author?: string | null },
	wantTitle: string,
	wantArtist?: string | null,
): number {
	const title = normalizeTrackText(track.title ?? '');
	const author = normalizeTrackText(track.author ?? '');
	const wantT = normalizeTrackText(wantTitle);
	const wantA = wantArtist ? normalizeTrackText(wantArtist) : '';

	if (!title || !wantT) return 0;

	const titleTokens = tokenSet(title);
	const wantTitleTokens = tokenSet(wantT);
	let titleHits = 0;
	for (const t of wantTitleTokens) if (titleTokens.has(t)) titleHits++;
	const titleScore = wantTitleTokens.size ? titleHits / wantTitleTokens.size : 0;

	// Exact / contains bonus
	let titleBonus = 0;
	if (title === wantT) titleBonus = 0.25;
	else if (title.includes(wantT) || wantT.includes(title)) titleBonus = 0.1;

	let artistScore = 0.5; // neutral when no expected artist
	if (wantA) {
		const artistTokens = tokenSet(author);
		const wantArtistTokens = tokenSet(wantA);
		let hits = 0;
		for (const t of wantArtistTokens) if (artistTokens.has(t) || titleTokens.has(t)) hits++;
		artistScore = wantArtistTokens.size ? hits / wantArtistTokens.size : 0;
	}

	return Math.min(1, titleScore * 0.7 + artistScore * 0.3 + titleBonus);
}

/** Pick the best matching track; reject weak matches (prevents wrong covers / wrong artists). */
export function pickBestTrack<T extends { title?: string | null; author?: string | null }>(
	tracks: T[],
	wantTitle: string,
	wantArtist?: string | null,
	minScore = 0.45,
): T | null {
	if (!tracks.length) return null;
	let best: T | null = null;
	let bestScore = -1;
	for (const track of tracks) {
		const score = trackMatchScore(track, wantTitle, wantArtist);
		if (score > bestScore) {
			bestScore = score;
			best = track;
		}
	}
	if (!best || bestScore < minScore) return null;
	return best;
}

/** True if the member is in the same VC as the bot's player */
export function inSameVC(
	playerChannelId: string | null | undefined,
	memberChannelId: string | null | undefined,
): boolean {
	return !!playerChannelId && playerChannelId === memberChannelId;
}

/**
 * Set (or clear) a voice channel's status via the Discord REST API.
 * Pass `null` to clear the status.
 */
export async function setVoiceChannelStatus(client: Client, channelId: string, status: string | null): Promise<void> {
	await client.rest.put(`/channels/${channelId}/voice-status`, { body: { status: status ?? '' } }).catch(() => null);
}

/**
 * Related tracks for autoplay, seeded from a title/artist.
 *
 * Prefers Spotify related-artists + top tracks (accurate metadata). Avoids
 * brittle "{Artist} Radio" playlist search which often returns wrong lists.
 * Falls back to recommendations / artist top tracks when available.
 */
export async function spotifyRadio(title: string, author: string, limit = 10): Promise<SpotifyTrackResult[]> {
	const token = await getSpotifyToken();
	if (!token) return [];

	const headers = { Authorization: `Bearer ${token}` };
	const seen = new Set<string>();
	const out: SpotifyTrackResult[] = [];

	const push = (t: SpotifyApiTrack | null | undefined) => {
		const mapped = t ? mapSpotifyTrack(t) : null;
		if (!mapped || seen.has(mapped.url)) return;
		seen.add(mapped.url);
		out.push(mapped);
	};

	// Resolve seed track
	const q = encodeURIComponent(author && author !== 'Unknown' ? `track:${title} artist:${author}` : `track:${title}`);
	const searchRes = await fetch(`https://api.spotify.com/v1/search?q=${q}&type=track&limit=5`, { headers });
	let seed: SpotifyApiTrack | null = null;
	if (searchRes.ok) {
		const searchJson = (await searchRes.json()) as { tracks?: { items?: SpotifyApiTrack[] } };
		const items = searchJson.tracks?.items ?? [];
		const scored = items.map((t) => ({
			raw: t,
			title: t.name,
			author: t.artists?.[0]?.name ?? null,
		}));
		const best = pickBestTrack(scored, title, author, 0.35);
		seed = best?.raw ?? items[0] ?? null;
	}
	if (!seed) {
		const loose = await spotifySearch(author && author !== 'Unknown' ? `${author} ${title}` : title, 3);
		// spotifySearch returns SpotifyTrackResult — need artist id path; fall through to empty if no seed
		if (!loose.length) return [];
		// Re-fetch first hit as full track via search URL already have metadata but not artist id —
		// do another search for recommendations path
		const again = await fetch(
			`https://api.spotify.com/v1/search?q=${encodeURIComponent(`${loose[0].title} ${loose[0].artist}`)}&type=track&limit=1`,
			{ headers },
		);
		if (again.ok) {
			const j = (await again.json()) as { tracks?: { items?: SpotifyApiTrack[] } };
			seed = j.tracks?.items?.[0] ?? null;
		}
		if (!seed) return loose.slice(0, limit);
	}

	const seedArtistId = seed.artists?.[0]?.id;
	const seedTrackId = seed.id;
	const seedMapped = mapSpotifyTrack(seed);
	if (seedMapped) seen.add(seedMapped.url); // don't re-queue the seed itself

	// Related artists' top tracks (best available "radio" without recommendations API)
	if (seedArtistId) {
		const relatedRes = await fetch(`https://api.spotify.com/v1/artists/${seedArtistId}/related-artists`, {
			headers,
		});
		const relatedIds: string[] = [];
		if (relatedRes.ok) {
			const relatedJson = (await relatedRes.json()) as { artists?: Array<{ id?: string }> };
			for (const a of relatedJson.artists ?? []) {
				if (a.id) relatedIds.push(a.id);
				if (relatedIds.length >= 5) break;
			}
		}
		relatedIds.unshift(seedArtistId);

		for (const artistId of relatedIds) {
			if (out.length >= limit) break;
			const topRes = await fetch(`https://api.spotify.com/v1/artists/${artistId}/top-tracks?market=US`, {
				headers,
			});
			if (!topRes.ok) continue;
			const topJson = (await topRes.json()) as { tracks?: SpotifyApiTrack[] };
			for (const t of topJson.tracks ?? []) {
				push(t);
				if (out.length >= limit) break;
			}
		}
	}

	// Official recommendations endpoint when still available for this app
	if (out.length < limit && (seedTrackId || seedArtistId)) {
		const params = new URLSearchParams({ limit: String(limit) });
		if (seedTrackId) params.set('seed_tracks', seedTrackId);
		if (seedArtistId) params.set('seed_artists', seedArtistId);
		const recRes = await fetch(`https://api.spotify.com/v1/recommendations?${params}`, { headers });
		if (recRes.ok) {
			const recJson = (await recRes.json()) as { tracks?: SpotifyApiTrack[] };
			for (const t of recJson.tracks ?? []) {
				push(t);
				if (out.length >= limit) break;
			}
		}
	}

	return out.slice(0, limit);
}

export function saveMusicQueue(_player: Player): Promise<void> {
	// Music queues intentionally start clean after every restart.
	return Promise.resolve();
}

export async function clearMusicQueue(guildId: string): Promise<void> {
	try {
		await db.delete(schema.musicQueues).where(eq(schema.musicQueues.guildId, guildId));
	} catch (err) {
		container.logger.error(`[Music] Failed to clear queue for guild ${guildId}:`, err);
	}
}

export { container };
