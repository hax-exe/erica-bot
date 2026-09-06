export type SnipeEntry = {
	content: string;
	authorId: string;
	authorTag: string;
	avatarUrl: string;
	createdAt: number;
	snipedAt: number;
	attachments: string[];
	/** Present for edits — content before the edit */
	beforeContent?: string;
};

const MAX_PER_CHANNEL = 10;
const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

const deleted = new Map<string, SnipeEntry[]>();
const edited = new Map<string, SnipeEntry[]>();

function push(map: Map<string, SnipeEntry[]>, channelId: string, entry: SnipeEntry): void {
	const list = map.get(channelId) ?? [];
	list.unshift(entry);
	while (list.length > MAX_PER_CHANNEL) list.pop();
	map.set(channelId, list);
}

function getAt(map: Map<string, SnipeEntry[]>, channelId: string, index: number): SnipeEntry | null {
	const list = (map.get(channelId) ?? []).filter((e) => Date.now() - e.snipedAt < MAX_AGE_MS);
	map.set(channelId, list);
	return list[index] ?? null;
}

export function recordDeleted(channelId: string, entry: SnipeEntry): void {
	push(deleted, channelId, entry);
}

export function recordEdited(channelId: string, entry: SnipeEntry): void {
	push(edited, channelId, entry);
}

export function getDeletedSnipe(channelId: string, index = 0): SnipeEntry | null {
	return getAt(deleted, channelId, index);
}

export function getEditedSnipe(channelId: string, index = 0): SnipeEntry | null {
	return getAt(edited, channelId, index);
}
