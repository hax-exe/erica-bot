import { container } from '@sapphire/framework';
import { USER_AGENT } from '../brand.js';

export interface TrackSuggestion {
	title: string;
	artist: string;
	durationMs: number;
}

const TIMEOUT_MS = 2_000;
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 200;
const WARN_COOLDOWN_MS = 5 * 60_000;

const cache = new Map<string, { at: number; value: TrackSuggestion[] }>();
const inflight = new Map<string, Promise<TrackSuggestion[]>>();
let lastWarn = 0;

type DeezerResponse = {
	data?: Array<{ title?: string; duration?: number; artist?: { name?: string } }>;
};

function warn(message: string, err?: unknown) {
	const now = Date.now();
	if (now - lastWarn < WARN_COOLDOWN_MS) return;
	lastWarn = now;
	try {
		container.logger?.warn(`[music] suggestions: ${message}`, err ?? '');
	} catch {
		// logger unavailable
	}
}

async function fetchSuggestions(query: string, limit: number): Promise<TrackSuggestion[]> {
	try {
		const res = await fetch(`https://api.deezer.com/search/track?q=${encodeURIComponent(query)}&limit=${limit}`, {
			headers: { 'User-Agent': USER_AGENT },
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		if (!res.ok) {
			warn(`Deezer returned HTTP ${res.status}`);
			return [];
		}
		const json = (await res.json()) as DeezerResponse;
		const out: TrackSuggestion[] = [];
		for (const t of json.data ?? []) {
			if (!t.title || !t.artist?.name) continue;
			out.push({ title: t.title, artist: t.artist.name, durationMs: (t.duration ?? 0) * 1000 });
		}
		return out;
	} catch (err) {
		warn('Deezer request failed', err);
		return [];
	}
}

/** Track suggestions for autocomplete via Deezer's public search. Never throws; returns [] on failure. */
export async function searchSuggestions(query: string, limit = 8): Promise<TrackSuggestion[]> {
	const key = `${limit}:${query.trim().toLowerCase()}`;
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

	const pending = inflight.get(key);
	if (pending) return pending;

	const p = fetchSuggestions(query, limit)
		.then((value) => {
			// Don't cache empty results: they are usually failures.
			if (value.length > 0) {
				if (cache.size >= CACHE_MAX) {
					const oldest = cache.keys().next().value;
					if (oldest !== undefined) cache.delete(oldest);
				}
				cache.set(key, { at: Date.now(), value });
			}
			return value;
		})
		.finally(() => inflight.delete(key));
	inflight.set(key, p);
	return p;
}

/** Test helper. */
export function _resetSuggestCache() {
	cache.clear();
	inflight.clear();
	lastWarn = 0;
}
