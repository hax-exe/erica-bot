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
