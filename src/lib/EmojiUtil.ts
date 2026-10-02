/** Parse a pasted custom emoji (`<:name:id>` / `<a:name:id>`). Returns null for anything else. */
export function parseCustomEmoji(raw: string): { animated: boolean; name: string; id: string } | null {
	const match = raw.trim().match(/^<(a)?:([\w]{2,32}):(\d{17,20})>$/);
	if (!match) return null;
	return { animated: Boolean(match[1]), name: match[2]!, id: match[3]! };
}
