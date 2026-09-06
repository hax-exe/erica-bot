import { eq } from 'drizzle-orm';
import { db, schema } from './database.js';

export const MODULES = [
	'leveling',
	'welcomer',
	'starboard',
	'birthdays',
	'spaces',
	'sticky',
	'tickets',
	'tags',
	'logging',
	'music',
	'reactionRoles',
	'reports',
	'reviews',
	'verification',
	'automod',
	'suggestions',
	'fun',
	'giveaways',
	'economy',
	'tts',
	'autoresponder',
] as const;

export type Module = (typeof MODULES)[number];

export const MODULE_LABELS: Record<Module, string> = {
	leveling: 'Leveling & XP',
	welcomer: 'Welcome / Leave Messages',
	starboard: 'Starboard',
	birthdays: 'Birthday Announcements',
	spaces: 'Temporary Voice Channels',
	sticky: 'Sticky Messages',
	tickets: 'Support Tickets',
	tags: 'Tags',
	logging: 'Audit Logging',
	music: 'Music',
	reactionRoles: 'Reaction Roles',
	reports: 'Reports',
	reviews: 'Ticket Reviews',
	verification: 'Minecraft Verification',
	automod: 'AutoMod',
	suggestions: 'Suggestions',
	fun: 'Fun & Games',
	giveaways: 'Giveaways',
	economy: 'Economy',
	tts: 'Text-to-Speech (TTS)',
	autoresponder: 'Autoresponder',
};

type ModuleRow = typeof schema.guildModules.$inferSelect;
type GlobalModuleRow = typeof schema.globalModules.$inferSelect;

export async function getOrCreateModules(guildId: string): Promise<ModuleRow> {
	const existing = await db.query.guildModules.findFirst({
		where: eq(schema.guildModules.guildId, guildId),
	});
	if (existing) return existing;

	await db.insert(schema.guildModules).values({ guildId });
	const [row] = await db.select().from(schema.guildModules).where(eq(schema.guildModules.guildId, guildId)).limit(1);
	return row!;
}

/** Get (or initialise) the singleton global modules row. */
export async function getGlobalModules(): Promise<GlobalModuleRow> {
	const existing = await db.query.globalModules.findFirst({
		where: eq(schema.globalModules.id, 1),
	});
	if (existing) return existing;

	await db.insert(schema.globalModules).values({ id: 1 });
	const [row] = await db.select().from(schema.globalModules).where(eq(schema.globalModules.id, 1)).limit(1);
	return row!;
}

/**
 * Returns whether a module is enabled for a guild.
 * Global override takes priority — if globally disabled, always returns false.
 * Falls back to true if no guild row exists.
 */
export async function isModuleEnabled(guildId: string, module: Module): Promise<boolean> {
	const [globalRow, guildRow] = await Promise.all([
		db.query.globalModules.findFirst({ where: eq(schema.globalModules.id, 1) }),
		db.query.guildModules.findFirst({ where: eq(schema.guildModules.guildId, guildId) }),
	]);

	// Global kill-switch: if explicitly false, disable everywhere
	if (globalRow && globalRow[module] === false) return false;

	// Per-guild setting (defaults to true if no row)
	return guildRow?.[module] ?? true;
}

/** Enable or disable a module for a specific guild. */
export async function setModule(guildId: string, module: Module, enabled: boolean): Promise<void> {
	await db
		.insert(schema.guildModules)
		.values({ guildId, [module]: enabled })
		.onDuplicateKeyUpdate({
			set: { [module]: enabled },
		});
}

/** Enable or disable a module globally (overrides all per-guild settings when false). */
export async function setGlobalModule(module: Module, enabled: boolean): Promise<void> {
	await db
		.insert(schema.globalModules)
		.values({ id: 1, [module]: enabled })
		.onDuplicateKeyUpdate({
			set: { [module]: enabled },
		});
}
