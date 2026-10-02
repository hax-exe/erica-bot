import { container } from '@sapphire/framework';
import type { Player, Track } from 'moonlink.js';
import { isYouTubeTrack, resolveNamedTrack } from './resolveTrack.js';

/** userData flag: this track already had one non-YouTube fallback attempt. */
export const YT_FALLBACK_FLAG = 'ytFallbackTried';

/** In-flight fallback attempts per guild; resolves true when a replacement started playing. */
const pending = new Map<string, Promise<boolean>>();

/**
 * Encoded YouTube tracks that already had their one fallback attempt, per guild.
 * Moonlink rebuilds Track objects for some events (trackEnd), so the userData flag alone
 * is not reliable — the encoded string is the stable key.
 */
const tried = new Map<string, Set<string>>();
const TRIED_CAP = 500;

function markTried(guildId: string, track: Track): void {
	track.userData ??= {};
	track.userData[YT_FALLBACK_FLAG] = true;
	if (!track.encoded) return;
	let set = tried.get(guildId);
	if (!set) {
		set = new Set();
		tried.set(guildId, set);
	}
	if (set.size >= TRIED_CAP) set.clear();
	set.add(track.encoded);
}

/** Pending fallback for a guild (queueEnd waits on it before tearing the session down). */
export function getPendingYouTubeFallback(guildId: string): Promise<boolean> | undefined {
	return pending.get(guildId);
}

/**
 * Whether a failed track should get a Deezer / SoundCloud retry.
 * Must be called synchronously inside the Moonlink event handler (before any await),
 * because Moonlink advances the queue right after emitting the event.
 */
export function shouldTryYouTubeFallback(guildId: string, track: Track | null | undefined): track is Track {
	if (!track || !isYouTubeTrack(track)) return false;
	// Streams: Moonlink does not auto-skip stuck streams (duration -1), and a live stream has no Deezer/SC equivalent.
	if (track.isStream || track.duration === -1) return false;
	if (track.userData?.isTTS) return false;
	if (track.userData?.[YT_FALLBACK_FLAG]) return false;
	if (track.encoded && tried.get(guildId)?.has(track.encoded)) return false;
	return true;
}

/** Turn YouTube metadata ("Artist - Topic", "Artist - Song (Official Video)") into title + artist. */
function cleanYouTubeMeta(track: Track): { title: string; artist: string | null } {
	let title = (track.title ?? '').trim();
	let artist: string | null =
		(track.author ?? '')
			.replace(/\s*-\s*Topic$/i, '')
			.replace(/VEVO$/i, '')
			.trim() || null;

	const dash = title.indexOf(' - ');
	if (dash > 0) {
		const left = title.slice(0, dash).trim();
		const right = title.slice(dash + 3).trim();
		// "Artist - Song" uploads: prefer the artist from the title when the channel name doesn't appear in it
		if (right && (!artist || !right.toLowerCase().includes(artist.toLowerCase()))) {
			artist = left;
			title = right;
		}
	}
	return { title, artist };
}

/**
 * Start a one-shot Deezer / SoundCloud fallback for a YouTube track that failed at playback.
 *
 * Call synchronously from the trackException / trackStuck / trackEnd(loadFailed) listener.
 * The upcoming queue is snapshotted *now*, before Moonlink advances. Moonlink may then advance
 * once (skip on error) or twice (skip + TrackEnd loadFailed), or end the queue; when a
 * replacement is found the queue is restored from the snapshot (plus anything users added
 * meanwhile) and the replacement plays in the failed track's slot.
 *
 * Resolves true when the replacement started; false means the normal skip path stands.
 */
export function startYouTubeFallback(player: Player, failed: Track): Promise<boolean> {
	markTried(player.guildId, failed);
	const snapshot = player.queue.tracks.slice();

	const run = (async (): Promise<boolean> => {
		const { logger, music } = container;
		const requester = (failed.requester ?? failed.userData?.requester) as string | undefined;
		const { title, artist } = cleanYouTubeMeta(failed);
		if (!title) return false;

		const replacement = await resolveNamedTrack(title, artist, requester ?? '', 0.45, { excludeYouTube: true }).catch(
			() => null,
		);
		if (!replacement) return false;

		// The player may have been destroyed (left / kicked / stopped) while we were searching.
		const live = music.players.get(player.guildId);
		if (!live || live !== player || player.destroyed) return false;

		replacement.userData = {
			...(failed.userData ?? {}),
			...(replacement.userData ?? {}),
			[YT_FALLBACK_FLAG]: true,
			fallbackFrom: failed.uri ?? null,
		};
		if (requester) replacement.setRequester(requester);
		// Never carry a resume offset from the failed track into a different recording.
		delete replacement.userData.resumePosition;

		// Restore what was queued after the failed track; keep anything added during the search.
		const snapSet = new Set(snapshot);
		const extras = player.queue.tracks.filter(
			(t) => !snapSet.has(t) && t !== failed && (!failed.encoded || t.encoded !== failed.encoded),
		);
		const current = player.current;
		const restored = snapshot.map((t) => {
			if (t !== current) return t;
			// Moonlink already started this one — requeue a fresh copy from the top.
			const copy = t.clone();
			copy.position = 0;
			return copy;
		});
		player.queue.tracks.splice(0, player.queue.tracks.length, ...restored, ...extras);

		// play({ track }) puts the replacement at the front and replaces whatever Moonlink advanced to
		// (NodeLink then reports TrackEnd "replaced", which Moonlink ignores).
		const started = await player.play({ track: replacement }).catch((err: unknown) => {
			logger.warn(`[music] YouTube fallback play failed in guild ${player.guildId}:`, err);
			return false;
		});
		if (started === false) return false;
		logger.info(
			`[music] YouTube playback failed for "${failed.title}" — playing ${replacement.sourceName} match "${replacement.title}" in guild ${player.guildId}.`,
		);
		return true;
	})()
		.catch((err: unknown) => {
			container.logger.warn(`[music] YouTube fallback errored in guild ${player.guildId}:`, err);
			return false;
		})
		.finally(() => {
			if (pending.get(player.guildId) === run) pending.delete(player.guildId);
		});

	pending.set(player.guildId, run);
	return run;
}
