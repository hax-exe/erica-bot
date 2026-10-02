/**
 * Bot owner IDs come from the comma-separated `BOT_OWNER_IDS` env var.
 * Parsed on every call so tests / hot reloads that change the env take effect immediately.
 */
export function getBotOwnerIds(): Set<string> {
	return new Set(
		(process.env.BOT_OWNER_IDS ?? '')
			.split(',')
			.map((id) => id.trim())
			.filter(Boolean),
	);
}

export function isBotOwner(userId: string): boolean {
	return getBotOwnerIds().has(userId);
}
