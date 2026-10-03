import { USER_AGENT } from './brand.js';

/**
 * Scam / phishing link list for the AutoMod `phishing` rule.
 *
 * Kept free of discord.js and the database so the pure helpers (`extractUrlHosts`, `findPhishingDomain`,
 * `parsePhishingList`) are trivial to unit test. The listener in `listeners/moderation/phishingListRefresh.ts`
 * drives `refreshPhishingList()` and does the logging.
 */

export const DEFAULT_PHISHING_LIST_URL = 'https://raw.githubusercontent.com/Discord-AntiScam/scam-links/main/list.json';

/** How often the list is re-downloaded. */
export const PHISHING_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

const FETCH_TIMEOUT_MS = 15_000;
/** Sanity cap on the downloaded list (the real one is under 1 MB). */
const MAX_LIST_CHARS = 20_000_000;

/** `PHISHING_LIST_URL` overrides the default list source. */
export function getPhishingListUrl(): string {
	return process.env.PHISHING_LIST_URL?.trim() || DEFAULT_PHISHING_LIST_URL;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/** A normalised hostname: lowercase ASCII (punycode) labels, at least two of them. */
const HOST_SHAPE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;
const NON_ASCII = /[\u0080-￿]/;

/**
 * Hosts in free text, in two forms:
 * - `http(s)://[userinfo@]host` (covers masked markdown links `[text](https://host/...)` and `user@host` tricks)
 * - scheme-less domains such as `discord-gift.com/claim`, which Discord renders as clickable links too
 *
 * Bare domains inside a URL path (`https://safe.com/page.html`) are not treated as hosts; the lookbehind
 * skips anything glued to a letter, digit, `@`, `.` or `/`. Letters are matched with `\p{L}` rather than a raw
 * code-unit range so emoji next to a domain cannot hide it.
 */
const URL_HOST_REGEX = new RegExp(
	[
		String.raw`https?:\/\/(?:[^\s/?#@]*@)?(?<urlHost>[\p{L}\p{N}\p{M}.-]+)`,
		String.raw`(?<![\p{L}\p{N}\p{M}@./])(?<bareHost>(?:[\p{L}\p{N}\p{M}-]+\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59}))(?![\p{L}\p{N}\p{M}-])`,
	].join('|'),
	'giu',
);

/**
 * Normalises a hostname for comparison: lowercase, trailing dot removed, IDN converted to punycode (the way a
 * browser resolves it) and a leading `www.` stripped. Returns null when it is not a plausible hostname.
 */
export function normalizeHost(raw: string): string | null {
	let host = raw.trim().toLowerCase().replace(/\.+$/, '');
	if (!host) return null;
	if (NON_ASCII.test(host)) {
		try {
			host = new URL(`http://${host}`).hostname;
		} catch {
			return null;
		}
	}
	host = host.replace(/^www\./, '');
	return HOST_SHAPE.test(host) ? host : null;
}

/** Normalises a list or whitelist entry (`https://www.Example.com/path` → `example.com`). */
function normalizeEntry(raw: string): string | null {
	const stripped = raw
		.trim()
		.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
		.split(/[/?#]/, 1)[0];
	return stripped ? normalizeHost(stripped) : null;
}

/**
 * Every normalised host referenced in `content`, deduplicated, in order of appearance. Uppercase hosts are
 * lowercased and `www.` is stripped.
 */
export function extractUrlHosts(content: string): string[] {
	const hosts = new Set<string>();
	for (const match of content.matchAll(URL_HOST_REGEX)) {
		const raw = match.groups?.urlHost ?? match.groups?.bareHost;
		const host = raw ? normalizeHost(raw) : null;
		if (host) hosts.add(host);
	}
	return [...hosts];
}

/** `a.b.example.com` → `a.b.example.com`, `b.example.com`, `example.com` (never a bare TLD). */
function hostAndParents(host: string): string[] {
	const labels = host.split('.');
	const out: string[] = [];
	for (let i = 0; i <= labels.length - 2; i++) out.push(labels.slice(i).join('.'));
	return out;
}

/**
 * The listed domain that `content` links to, or null. A hit is any URL host, or a parent domain of it, that is on
 * `domains` (already normalised, see `parsePhishingList`), unless the host is on `whitelist` (the guild's link
 * whitelist: a whitelisted domain also covers its subdomains).
 */
export function findPhishingDomain(
	content: string,
	domains: ReadonlySet<string>,
	whitelist: readonly string[] = [],
): string | null {
	if (domains.size === 0) return null;

	const allowed = new Set<string>();
	for (const entry of whitelist) {
		const normalized = normalizeEntry(entry);
		if (normalized) allowed.add(normalized);
	}

	for (const host of extractUrlHosts(content)) {
		const candidates = hostAndParents(host);
		if (candidates.some((c) => allowed.has(c))) continue;
		const hit = candidates.find((c) => domains.has(c));
		if (hit) return hit;
	}
	return null;
}

/**
 * Parses a downloaded list: a JSON array of domains, or plain text with one domain per line (blank lines and
 * `#` comments ignored). Entries are normalised and anything that is not a hostname (wildcards, single labels,
 * garbage) is dropped. Throws when the payload claims to be JSON but is not valid.
 */
export function parsePhishingList(raw: string): Set<string> {
	const text = raw.trim();
	let entries: unknown[];
	if (text.startsWith('[') || text.startsWith('{')) {
		const parsed: unknown = JSON.parse(text);
		if (!Array.isArray(parsed)) throw new Error('JSON list is not an array');
		entries = parsed;
	} else {
		entries = text.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith('#'));
	}

	const domains = new Set<string>();
	for (const entry of entries) {
		if (typeof entry !== 'string') continue;
		const domain = normalizeEntry(entry);
		if (domain) domains.add(domain);
	}
	return domains;
}

// ─── List state ───────────────────────────────────────────────────────────────

let phishingDomains: ReadonlySet<string> = new Set();
let lastRefreshAt: number | null = null;
let inFlight: Promise<PhishingRefreshResult> | null = null;

export type PhishingRefreshResult = { ok: true; size: number } | { ok: false; error: string };

/** The currently loaded list (empty until the first successful refresh). */
export function getPhishingDomains(): ReadonlySet<string> {
	return phishingDomains;
}

/** Size of the loaded list and the epoch-ms time of the last successful refresh (null if never loaded). */
export function getPhishingListState(): { size: number; refreshedAt: number | null } {
	return { size: phishingDomains.size, refreshedAt: lastRefreshAt };
}

export interface RefreshOptions {
	url?: string;
	/** Injectable for tests. */
	fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
}

/**
 * Downloads and swaps in the list. A failed or empty download keeps the previous list and returns
 * `{ ok: false, error }`; it never throws. Concurrent calls share one download.
 */
export function refreshPhishingList(options: RefreshOptions = {}): Promise<PhishingRefreshResult> {
	if (inFlight) return inFlight;
	const run = (async (): Promise<PhishingRefreshResult> => {
		try {
			const doFetch = options.fetchImpl ?? fetch;
			const res = await doFetch(options.url ?? getPhishingListUrl(), {
				headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, text/plain;q=0.9' },
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const body = await res.text();
			if (body.length > MAX_LIST_CHARS) throw new Error('list is unexpectedly large');
			const parsed = parsePhishingList(body);
			if (parsed.size === 0) throw new Error('list contained no valid domains');
			phishingDomains = parsed;
			lastRefreshAt = Date.now();
			return { ok: true, size: parsed.size };
		} catch (err) {
			return { ok: false, error: err instanceof Error ? err.message : String(err) };
		}
	})().finally(() => {
		inFlight = null;
	});
	inFlight = run;
	return run;
}
