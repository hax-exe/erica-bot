/**
 * Parses a human duration string into milliseconds.
 * Accepts compact forms (`2h`, `1h30m`, `7d`) and spaced forms (`1 hour`, `30 min`, `2 days`).
 * Returns null if the string cannot be parsed or resolves to 0.
 */
export function parseDuration(input: string): number | null {
	const clean = input.trim().toLowerCase().replace(/,/g, '');
	if (!clean) return null;

	// Compact: 1w2d3h4m5s (optional units, no spaces)
	const compact = clean.replace(/\s+/g, '');
	const compactMatch = compact.match(/^(?:(\d+)w)?(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
	if (compactMatch && compact !== '') {
		const weeks = parseInt(compactMatch[1] ?? '0', 10) || 0;
		const days = parseInt(compactMatch[2] ?? '0', 10) || 0;
		const hours = parseInt(compactMatch[3] ?? '0', 10) || 0;
		const minutes = parseInt(compactMatch[4] ?? '0', 10) || 0;
		const seconds = parseInt(compactMatch[5] ?? '0', 10) || 0;
		const totalMs = (weeks * 604800 + days * 86400 + hours * 3600 + minutes * 60 + seconds) * 1000;
		if (totalMs > 0) return totalMs;
	}

	// Spaced / word forms: "1 hour 30 minutes", "2 days", "45 mins"
	const wordRe = /(\d+)\s*(weeks?|w|days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/gi;
	let totalMs = 0;
	let matched = false;
	for (const m of clean.matchAll(wordRe)) {
		matched = true;
		const n = parseInt(m[1], 10);
		const unit = m[2].toLowerCase();
		if (unit.startsWith('w')) totalMs += n * 604_800_000;
		else if (unit.startsWith('d') && !unit.startsWith('mi')) totalMs += n * 86_400_000;
		else if (unit.startsWith('h')) totalMs += n * 3_600_000;
		else if (unit.startsWith('m')) totalMs += n * 60_000;
		else if (unit.startsWith('s')) totalMs += n * 1_000;
	}
	if (matched && totalMs > 0) return totalMs;

	return null;
}

/** Shared friendly error when a duration string can't be parsed. */
export const DURATION_HINT = 'Use a duration like `30m`, `1h`, `2h30m`, `1d`, or `1 hour 30 minutes`.';

/** Formats a millisecond duration into a short human-readable string, e.g. "2h 30m". */
export function humanDuration(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000);
	const days = Math.floor(totalSeconds / 86400);
	const hours = Math.floor((totalSeconds % 86400) / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;

	const parts: string[] = [];
	if (days > 0) parts.push(`${days}d`);
	if (hours > 0) parts.push(`${hours}h`);
	if (minutes > 0) parts.push(`${minutes}m`);
	if (seconds > 0 && days === 0) parts.push(`${seconds}s`);

	return parts.join(' ') || '0s';
}

/** Common duration presets for slash-command autocomplete. */
export const DURATION_PRESETS = [
	{ name: '5 minutes', value: '5m' },
	{ name: '10 minutes', value: '10m' },
	{ name: '30 minutes', value: '30m' },
	{ name: '1 hour', value: '1h' },
	{ name: '3 hours', value: '3h' },
	{ name: '6 hours', value: '6h' },
	{ name: '12 hours', value: '12h' },
	{ name: '1 day', value: '1d' },
	{ name: '3 days', value: '3d' },
	{ name: '7 days', value: '7d' },
] as const;

/** Filter duration presets for Discord autocomplete (max 25). */
export function autocompleteDuration(focused: string): { name: string; value: string }[] {
	const q = focused.trim().toLowerCase();
	const list = q ? DURATION_PRESETS.filter((p) => p.name.includes(q) || p.value.includes(q)) : [...DURATION_PRESETS];
	return list.slice(0, 25).map((p) => ({ name: p.name, value: p.value }));
}
