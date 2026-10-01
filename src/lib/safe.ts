import { isIP } from 'node:net';

/**
 * Parse a JSON string without throwing. Returns `fallback` for null/empty input,
 * malformed JSON, or (when `fallback` is an array) a parsed value that is not an array.
 */
export function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
	if (raw == null || raw === '') return fallback;
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (Array.isArray(fallback) && !Array.isArray(parsed)) return fallback;
		return (parsed ?? fallback) as T;
	} catch {
		return fallback;
	}
}

/**
 * True for an http(s) URL on a public DNS name — use before the bot fetches a user-supplied URL.
 * Rejects IP literals, localhost / single-label / .local / .internal hosts, explicit ports and
 * credentials, so a URL can't point the bot at its own network (e.g. 127.0.0.1, the Docker host,
 * cloud metadata at 169.254.169.254, or a compose service like `nodelink:3000`).
 */
export function isPublicHttpUrl(input: string, maxLength = 2048): boolean {
	if (!input || input.length > maxLength) return false;
	let url: URL;
	try {
		url = new URL(input);
	} catch {
		return false;
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
	// URL() normalises default ports to '' — anything left is an explicit, non-default port.
	if (url.port || url.username || url.password) return false;
	// URL() also canonicalises numeric/hex IPv4 forms (e.g. 2130706433 → 127.0.0.1); IPv6 keeps brackets.
	const host = url.hostname.toLowerCase().replace(/\.$/, '');
	if (isIP(host.replace(/^\[|\]$/g, ''))) return false;
	if (!host.includes('.') || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
		return false;
	}
	return true;
}

/**
 * True when `err` is a MySQL duplicate-key violation (ER_DUP_ENTRY / errno 1062).
 * Drizzle wraps driver errors (`DrizzleQueryError`), so the mysql2 error may sit on `cause`.
 */
export function isDuplicateKeyError(err: unknown): boolean {
	let current: any = err;
	for (let depth = 0; current && depth < 5; depth++) {
		if (current.code === 'ER_DUP_ENTRY' || current.errno === 1062) return true;
		current = current.cause;
	}
	return false;
}
