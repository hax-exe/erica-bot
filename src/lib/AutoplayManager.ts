/**
 * Guild autoplay preference + Erica-owned next-track pipeline.
 *
 * Moonlink native autoPlay stays off. We keep a small queue buffer of related
 * tracks so skip never "ends" autoplay. Discovery prefers Spotify-related
 * tracks (accurate title/artist/art), then rematches to YouTube Music.
 */

import { container } from '@sapphire/framework';
import type { Player, Track } from 'moonlink.js';
import { db, schema } from './database.js';
import {
	type SpotifyTrackResult,
	saveMusicQueue,
	spotifyLookupTrack,
	spotifyRadio,
	trackMatchScore,
} from './MusicManager.js';
import { resolveNamedTrack } from './music/resolveTrack.js';

/** How many upcoming autoplay tracks to keep queued. */
const TARGET_BUFFER = 3;
const RECENT_LIMIT = 32;
/** Reject weak YouTube rematches — wrong covers / lyric videos. */
const RESOLVE_MIN_SCORE = 0.55;
/** Spotify lookup must be this close to the Mix title before we trust it. */
const SPOTIFY_CONFIRM_MIN = 0.5;

/** Persisted preference per guild (mirrored in DB). */
export const autoplayEnabled = new Map<string, boolean>();

/** Recent track identifiers per guild — avoid immediate repeats. */
const recentIds = new Map<string, string[]>();

/** Last non-TTS track per guild (seed when queueEnd loses lastTrack). */
const lastSeeds = new Map<string, Track>();

/** Guilds currently filling autoplay tracks. */
const inFlight = new Set<string>();
/** Shared fill promise per guild so queueEnd waits for an existing refill instead of declaring autoplay dead. */
const bufferFills = new Map<string, Promise<number>>();

export function isAutoplayOn(guildId: string): boolean {
	return autoplayEnabled.get(guildId) === true;
}

/** Always disable Moonlink native autoPlay — Erica handles fills. */
export function applyAutoplayToPlayer(player: Player): void {
	player.setAutoPlay(false);
}

export function setAutoplay(guildId: string, enabled: boolean, player?: Player | null): void {
	autoplayEnabled.set(guildId, enabled);
	if (player) player.setAutoPlay(false);

	db.insert(schema.guilds)
		.values({ id: guildId, autoplayEnabled: enabled })
		.onDuplicateKeyUpdate({
			set: { autoplayEnabled: enabled },
		})
		.catch((err) => container.logger.warn(`Failed to save autoplayEnabled for ${guildId}:`, err));

	// Turning on mid-session — start buffering related tracks now
	if (enabled && player?.current) {
		void ensureAutoplayBuffer(player, player.current).catch((err) =>
			container.logger.warn(`[autoplay] buffer on enable failed for ${guildId}:`, err),
		);
	}
}

/** Remember the track that just started (for skip / queueEnd seeding). */
export function rememberAutoplaySeed(track: Track | null | undefined, guildId: string): void {
	if (!track || track.userData?.isTTS) return;
	lastSeeds.set(guildId, track);
	rememberId(guildId, track.identifier);
}

function rememberId(guildId: string, id: string | null | undefined): void {
	if (!id) return;
	const list = recentIds.get(guildId) ?? [];
	if (list[list.length - 1] === id) return;
	list.push(id);
	while (list.length > RECENT_LIMIT) list.shift();
	recentIds.set(guildId, list);
}

function collectExcludeIds(player: Player, seed?: Track | null): Set<string> {
	const exclude = new Set<string>(recentIds.get(player.guildId) ?? []);
	if (seed?.identifier) exclude.add(seed.identifier);
	if (player.current?.identifier) exclude.add(player.current.identifier);
	for (const t of player.queue.tracks as Track[]) {
		if (t.identifier) exclude.add(t.identifier);
	}
	return exclude;
}

/** Extract a YouTube video id from a Moonlink track when possible. */
export function youtubeVideoId(track: Track | null | undefined): string | null {
	if (!track) return null;
	const id = track.identifier?.trim();
	if (id && /^[\w-]{11}$/.test(id)) {
		const src = (track.sourceName ?? '').toLowerCase();
		if (!src || src.includes('youtube') || src === 'youtubemusic') return id;
	}
	const uri = track.uri ?? '';
	try {
		const u = new URL(uri);
		const host = u.hostname.toLowerCase();
		if (host === 'youtu.be') {
			const short = u.pathname.replace(/^\//, '').slice(0, 11);
			return /^[\w-]{11}$/.test(short) ? short : null;
		}
		if (host.includes('youtube.com') || host.includes('music.youtube.com')) {
			const v = u.searchParams.get('v');
			if (v && /^[\w-]{11}$/.test(v)) return v;
		}
	} catch {
		// ignore
	}
	return null;
}

interface AutoplayCandidate {
	title: string;
	artist: string | null;
	identifier?: string | null;
	spotify?: SpotifyTrackResult | null;
}

/** Clean "Artist - Topic" / "Song (Official Video)" style Mix titles. */
function parseCandidateTitle(rawTitle: string, rawAuthor: string | null): { title: string; artist: string | null } {
	let title = rawTitle.replace(/\s+/g, ' ').trim();
	let artist = rawAuthor?.replace(/\s*-?\s*Topic\s*$/i, '').trim() || null;

	title = title
		.replace(
			/\b(official\s+(music\s+)?video|official\s+audio|lyrics?(?:\s+video)?|visuali[sz]er|audio|hd|4k|mv)\b/gi,
			'',
		)
		.replace(/[([].*?[)\]]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

	const split = title.match(/^(.{1,80}?)\s*[-–—]\s*(.+)$/);
	if (split) {
		const left = split[1].trim();
		const right = split[2].trim();
		// Prefer "Artist - Song" when author is missing/Topic; else "Song - Artist"
		if (!artist || /topic/i.test(rawAuthor ?? '')) {
			artist = left;
			title = right;
		} else if (
			trackMatchScore({ title: right, author: left }, right, artist) >
			trackMatchScore({ title: left, author: right }, left, artist)
		) {
			title = right;
			if (!artist) artist = left;
		} else {
			title = left;
			if (!artist) artist = right;
		}
	}

	return { title: title || rawTitle, artist };
}

async function discoverSpotifyCandidates(seed: Track): Promise<AutoplayCandidate[]> {
	const title = seed.title ?? '';
	const author = seed.author ?? '';
	if (!title) return [];
	const radio = await spotifyRadio(title, author, 20);
	return radio.map((t) => ({
		title: t.title,
		artist: t.artist,
		spotify: t,
	}));
}

async function discoverMixCandidates(seed: Track, requester: string): Promise<AutoplayCandidate[]> {
	const videoId = youtubeVideoId(seed);
	if (!videoId) return [];

	const { music } = container;
	const mixUrl = `https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}`;
	try {
		const result = await music.search({ query: mixUrl, source: 'youtube', requester });
		const tracks = (result?.tracks ?? []) as Track[];
		const out: AutoplayCandidate[] = [];
		for (const t of tracks.slice(0, 15)) {
			const parsed = parseCandidateTitle(t.title ?? 'Unknown', t.author ?? null);
			out.push({
				title: parsed.title,
				artist: parsed.artist,
				identifier: t.identifier,
			});
		}
		return out;
	} catch (err) {
		container.logger.warn('[autoplay] YouTube Mix discovery failed:', err);
		return [];
	}
}

function applyMetadata(track: Track, meta: SpotifyTrackResult | null, requester: string): void {
	if (meta) {
		track.title = meta.title;
		track.author = meta.artist;
		if (meta.artworkUrl) track.artworkUrl = meta.artworkUrl;
		const plugin = (track.pluginInfo ?? {}) as Record<string, unknown>;
		if (meta.album) plugin.albumName = meta.album;
		track.pluginInfo = plugin;
	}
	if (!track.userData) track.userData = {};
	track.userData.autoplay = true;
	if (meta?.url) track.userData.spotifyUrl = meta.url;
	if (/^\d{17,20}$/.test(requester)) {
		track.userData.requester = requester;
		track.setRequester?.(requester);
	} else {
		delete track.userData.requester;
	}
}

/**
 * Resolve one related track and append it to the queue (play if idle).
 * @returns true if a track was queued.
 */
export async function enqueueAutoplayTrack(player: Player, seedTrack?: Track | null): Promise<boolean> {
	const guildId = player.guildId;
	if (!isAutoplayOn(guildId)) return false;
	if (inFlight.has(guildId)) return false;

	const seed = seedTrack ?? player.current ?? lastSeeds.get(guildId) ?? null;
	if (!seed?.title) return false;

	inFlight.add(guildId);
	try {
		const requester = (seed.userData?.requester as string | undefined) ?? 'autoplay';
		const exclude = collectExcludeIds(player, seed);

		// Spotify-first: real related tracks with clean metadata. Mix is fallback only.
		let candidates = await discoverSpotifyCandidates(seed);
		if (!candidates.length) {
			candidates = await discoverMixCandidates(seed, requester);
		}
		if (!candidates.length) return false;

		for (const cand of candidates) {
			if (cand.identifier && exclude.has(cand.identifier)) continue;

			// Confirm identity on Spotify (Mix titles especially) before rematching streams.
			let spotify = cand.spotify ?? null;
			if (!spotify) {
				spotify = await spotifyLookupTrack(cand.title, cand.artist).catch(() => null);
				if (spotify) {
					const score = trackMatchScore({ title: spotify.title, author: spotify.artist }, cand.title, cand.artist);
					if (score < SPOTIFY_CONFIRM_MIN) spotify = null;
				}
			}
			if (!spotify) continue;

			const resolved = await resolveNamedTrack(spotify.title, spotify.artist, requester, RESOLVE_MIN_SCORE);
			if (!resolved) continue;
			if (resolved.identifier && exclude.has(resolved.identifier)) continue;

			// Final guard: rematched stream must still look like the Spotify song
			const matchScore = trackMatchScore(resolved, spotify.title, spotify.artist);
			if (matchScore < RESOLVE_MIN_SCORE) continue;

			applyMetadata(resolved, spotify, requester);

			const wasPlaying = player.playing || !!player.current;
			player.queue.add(resolved);
			if (!wasPlaying) {
				await player.play().catch((err) => {
					container.logger.warn(`[autoplay] play() failed for guild ${guildId}:`, err);
				});
			}

			rememberId(guildId, resolved.identifier);
			await saveMusicQueue(player).catch(() => null);
			container.logger.info(
				`[autoplay] Queued "${resolved.title}" — ${resolved.author ?? '?'} (score ${matchScore.toFixed(2)}) for guild ${guildId}`,
			);
			return true;
		}

		return false;
	} finally {
		inFlight.delete(guildId);
	}
}

/**
 * Keep `TARGET_BUFFER` upcoming tracks so skip never drains into idle.
 * @returns number of tracks added.
 */
async function fillAutoplayBuffer(player: Player, seedTrack?: Track | null): Promise<number> {
	if (!isAutoplayOn(player.guildId)) return 0;

	const seed = seedTrack ?? player.current ?? lastSeeds.get(player.guildId) ?? null;
	let added = 0;

	while (player.queue.size < TARGET_BUFFER) {
		const ok = await enqueueAutoplayTrack(player, seed);
		if (!ok) break;
		added++;
	}
	return added;
}

export function ensureAutoplayBuffer(player: Player, seedTrack?: Track | null): Promise<number> {
	const guildId = player.guildId;
	const existing = bufferFills.get(guildId);
	if (existing) return existing;

	const fill = fillAutoplayBuffer(player, seedTrack).finally(() => {
		if (bufferFills.get(guildId) === fill) bufferFills.delete(guildId);
	});
	bufferFills.set(guildId, fill);
	return fill;
}
