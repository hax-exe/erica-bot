/**
 * Join list lines for a reply without exceeding a length budget. Lines that don't fit are
 * summarised as "…and N more", so a long list can't hit Discord's 2000-character content
 * limit (error 50035). Leave room in `maxLength` for any header the caller prepends.
 */
export function joinLinesCapped(lines: readonly string[], maxLength = 1800): string {
	const kept: string[] = [];
	let length = 0;
	for (let i = 0; i < lines.length; i++) {
		const added = (kept.length ? 1 : 0) + lines[i].length;
		const remainingAfter = lines.length - i - 1;
		// Keep room for the summary line unless this is the last line.
		const reserve = remainingAfter > 0 ? `\n…and ${remainingAfter} more`.length : 0;
		if (length + added + reserve > maxLength) {
			const omitted = lines.length - i;
			return kept.length ? `${kept.join('\n')}\n…and ${omitted} more` : `…and ${omitted} more`;
		}
		kept.push(lines[i]);
		length += added;
	}
	return kept.join('\n');
}

/** Shorten user-supplied text (e.g. a reason) for a one-line list entry. */
export function clip(text: string, max = 100): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
