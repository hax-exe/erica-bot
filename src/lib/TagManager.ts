import type { ApplicationCommandOptionChoiceData } from 'discord.js';
import { eq } from 'drizzle-orm';
import { db, schema } from './database.js';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type TagEmbed = {
	title?: string;
	description?: string;
	color?: number;
	image?: string;
	thumbnail?: string;
	footer?: string;
	fields?: Array<{ name: string; value: string; inline?: boolean }>;
};

export type TagData = {
	id: number;
	guildId: string;
	name: string;
	aliases: string[];
	content: string | null;
	embed: TagEmbed | null;
};

// ─── Row parser ────────────────────────────────────────────────────────────────

function parseRow(row: typeof schema.tags.$inferSelect): TagData {
	return {
		id: row.id,
		guildId: row.guildId,
		name: row.name,
		aliases: JSON.parse(row.aliases) as string[],
		content: row.content ?? null,
		embed: row.embed ? (JSON.parse(row.embed) as TagEmbed) : null,
	};
}

// ─── Queries ───────────────────────────────────────────────────────────────────

/** Resolve a tag by name or alias for a guild. */
export async function resolveTag(guildId: string, nameOrAlias: string): Promise<TagData | null> {
	const lower = nameOrAlias.toLowerCase();
	const rows = await db.select().from(schema.tags).where(eq(schema.tags.guildId, guildId));

	const byName = rows.find((r) => r.name.toLowerCase() === lower);
	if (byName) return parseRow(byName);

	const byAlias = rows.find((r) => (JSON.parse(r.aliases) as string[]).map((a) => a.toLowerCase()).includes(lower));
	return byAlias ? parseRow(byAlias) : null;
}

/** Get up to 25 autocomplete choices filtered by the current input, for a guild. */
export async function getTagChoices(
	guildId: string,
	input: string,
): Promise<ApplicationCommandOptionChoiceData<string>[]> {
	const rows = await db.select({ name: schema.tags.name }).from(schema.tags).where(eq(schema.tags.guildId, guildId));

	const q = input.toLowerCase();
	const choices: ApplicationCommandOptionChoiceData<string>[] = [];

	for (const row of rows) {
		if (choices.length >= 25) break;
		if (q && !row.name.toLowerCase().startsWith(q)) continue;
		choices.push({ name: row.name, value: row.name });
	}
	return choices;
}

/** Get all tags for a guild. */
export async function getGuildTags(guildId: string): Promise<TagData[]> {
	const rows = await db.select().from(schema.tags).where(eq(schema.tags.guildId, guildId));
	return rows.map(parseRow);
}
