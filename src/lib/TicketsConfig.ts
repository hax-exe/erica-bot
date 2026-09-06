import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const HEX_COLOR = z
	.string()
	.regex(/^#?[0-9A-Fa-f]{6}$/, 'Expected a hex color like #9370DB')
	.transform((s) => (s.startsWith('#') ? s : `#${s}`));

const optionSchema = z.object({
	value: z.string().min(1).max(100),
	label: z.string().min(1).max(100),
	description: z.string().max(100).optional(),
	emoji: z.string().max(32).optional(),
	default: z.boolean().optional(),
});

const questionBase = z.object({
	id: z.string().min(1).max(100),
	label: z.string().min(1).max(45),
	description: z.string().max(100).optional(),
	required: z.boolean().default(true),
});

const textQuestionSchema = questionBase.extend({
	type: z.literal('text'),
	style: z.enum(['short', 'paragraph']).default('paragraph'),
	placeholder: z.string().max(100).optional(),
	minLength: z.number().int().min(0).max(4000).optional(),
	maxLength: z.number().int().min(1).max(4000).optional(),
});

const selectQuestionSchema = questionBase.extend({
	type: z.literal('select'),
	placeholder: z.string().max(150).optional(),
	minValues: z.number().int().min(0).max(25).optional(),
	maxValues: z.number().int().min(1).max(25).optional(),
	options: z.array(optionSchema).min(1).max(25),
});

const fileQuestionSchema = questionBase.extend({
	type: z.literal('file'),
	minValues: z.number().int().min(0).max(10).optional(),
	maxValues: z.number().int().min(1).max(10).optional(),
});

const checkboxQuestionSchema = questionBase.extend({
	type: z.literal('checkbox'),
	required: z.boolean().default(false),
	default: z.boolean().optional(),
});

const checkboxGroupQuestionSchema = questionBase.extend({
	type: z.literal('checkboxGroup'),
	minValues: z.number().int().min(0).max(10).optional(),
	maxValues: z.number().int().min(1).max(10).optional(),
	options: z.array(optionSchema).min(1).max(10),
});

export const ticketQuestionSchema = z.discriminatedUnion('type', [
	textQuestionSchema,
	selectQuestionSchema,
	fileQuestionSchema,
	checkboxQuestionSchema,
	checkboxGroupQuestionSchema,
]);

export type TicketQuestion = z.infer<typeof ticketQuestionSchema>;

const categorySchema = z.object({
	id: z.string().min(1).max(100),
	label: z.string().min(1).max(100),
	enabled: z.boolean().default(true),
	emoji: z.string().max(32).nullable().optional(),
	description: z.string().max(100).nullable().optional(),
	discordCategoryId: z.string().min(1).nullable().optional(),
	staffRoleIds: z.array(z.string().min(1)).default([]),
	nameTemplate: z.string().min(1).max(100).default('ticket-{username}'),
	openMessage: z.string().min(1).default('Thanks for creating a ticket! Staff will be with you shortly.'),
	color: HEX_COLOR.nullable().optional(),
	maxOpenTickets: z.number().int().min(1).max(25).default(1),
	questions: z.array(ticketQuestionSchema).max(5).default([]),
});

const statusChannelsSchema = z
	.object({
		/** Voice channel renamed to `Open Tickets: N` */
		openTicketsChannelId: z.string().min(1).nullable().optional(),
		/** Voice channel renamed to `Total Tickets: N` */
		totalTicketsChannelId: z.string().min(1).nullable().optional(),
		/** Voice channel renamed to `Rated ⭐ X.XX /5` */
		avgRatingChannelId: z.string().min(1).nullable().optional(),
		/** Voice channel renamed to `Avg Time: …` */
		avgTimeChannelId: z.string().min(1).nullable().optional(),
	})
	.default({});

const panelSchema = z.object({
	channelId: z.string().min(1),
	title: z.string().min(1).max(256).default('Support Tickets'),
	description: z
		.string()
		.min(1)
		.default('Need help? Click a button below to open a support ticket.\nOur staff will be with you shortly.'),
	color: HEX_COLOR.default('#9370DB'),
	closeConfirmation: z.boolean().default(true),
	dmOnOpen: z.boolean().default(true),
	dmOnClose: z.boolean().default(false),
	closedCategoryId: z.string().min(1).nullable().optional(),
	/** Locked voice channels used as live Support Status labels in the sidebar */
	statusChannels: statusChannelsSchema,
});

export const ticketsConfigSchema = z.object({
	guildId: z.string().min(1).optional(),
	panel: panelSchema,
	categories: z.array(categorySchema).min(1),
});

export type TicketsConfigFile = z.infer<typeof ticketsConfigSchema>;

/** Parsed hex → Discord integer color. */
export function parseHexColor(hex: string): number {
	const raw = hex.startsWith('#') ? hex.slice(1) : hex;
	const n = Number.parseInt(raw, 16);
	if (Number.isNaN(n)) throw new Error(`Invalid hex color: ${hex}`);
	return n;
}

export type TicketStatusChannels = {
	openTicketsChannelId: string | null;
	totalTicketsChannelId: string | null;
	avgRatingChannelId: string | null;
	avgTimeChannelId: string | null;
};

export type TicketSettings = {
	guildId: string | null;
	panelTitle: string;
	panelDescription: string;
	panelColor: number;
	panelChannelId: string;
	closeConfirmation: boolean;
	dmOnOpen: boolean;
	dmOnClose: boolean;
	closedCategoryId: string | null;
	statusChannels: TicketStatusChannels;
};

export type TicketCategoryData = {
	guildId: string | null;
	categoryId: string;
	label: string;
	enabled: boolean;
	emoji: string | null;
	description: string | null;
	staffRoleIds: string[];
	discordCategoryId: string | null;
	nameTemplate: string;
	openMessage: string;
	color: number | null;
	maxOpenTickets: number;
	questions: TicketQuestion[];
	sortOrder: number;
};

export type LoadedTicketsConfig = {
	raw: TicketsConfigFile;
	settings: TicketSettings;
	categories: TicketCategoryData[];
};

const DEFAULT_PATH = path.join(process.cwd(), 'config', 'tickets.yml');

let cached: LoadedTicketsConfig | null = null;
let configPath = DEFAULT_PATH;

function mapConfig(parsed: TicketsConfigFile): LoadedTicketsConfig {
	const guildId = parsed.guildId ?? null;
	const settings: TicketSettings = {
		guildId,
		panelTitle: parsed.panel.title,
		panelDescription: parsed.panel.description,
		panelColor: parseHexColor(parsed.panel.color),
		panelChannelId: parsed.panel.channelId,
		closeConfirmation: parsed.panel.closeConfirmation,
		dmOnOpen: parsed.panel.dmOnOpen,
		dmOnClose: parsed.panel.dmOnClose,
		closedCategoryId: parsed.panel.closedCategoryId ?? null,
		statusChannels: {
			openTicketsChannelId: parsed.panel.statusChannels.openTicketsChannelId ?? null,
			totalTicketsChannelId: parsed.panel.statusChannels.totalTicketsChannelId ?? null,
			avgRatingChannelId: parsed.panel.statusChannels.avgRatingChannelId ?? null,
			avgTimeChannelId: parsed.panel.statusChannels.avgTimeChannelId ?? null,
		},
	};

	const categories: TicketCategoryData[] = parsed.categories.map((cat, index) => ({
		guildId,
		categoryId: cat.id,
		label: cat.label,
		enabled: cat.enabled,
		emoji: cat.emoji ?? null,
		description: cat.description ?? null,
		staffRoleIds: cat.staffRoleIds,
		discordCategoryId: cat.discordCategoryId ?? null,
		nameTemplate: cat.nameTemplate,
		openMessage: cat.openMessage,
		color: cat.color ? parseHexColor(cat.color) : null,
		maxOpenTickets: cat.maxOpenTickets,
		questions: cat.questions,
		sortOrder: index,
	}));

	return { raw: parsed, settings, categories };
}

function readAndParse(filePath: string): LoadedTicketsConfig {
	if (!fs.existsSync(filePath)) {
		throw new Error(
			`Ticket config not found at ${filePath}. Copy config/tickets.example.yml to config/tickets.yml and fill in Discord IDs.`,
		);
	}
	const text = fs.readFileSync(filePath, 'utf8');
	let yamlData: unknown;
	try {
		yamlData = parseYaml(text);
	} catch (err) {
		throw new Error(`Failed to parse ticket YAML: ${err instanceof Error ? err.message : String(err)}`);
	}
	const parsed = ticketsConfigSchema.parse(yamlData);
	return mapConfig(parsed);
}

/** Load (or reload) tickets.yml into memory. Throws on missing/invalid config. */
export function loadTicketsConfig(filePath: string = configPath): LoadedTicketsConfig {
	configPath = filePath;
	cached = readAndParse(filePath);
	return cached;
}

/** Re-read tickets.yml and swap the cache. */
export function reloadTicketsConfig(filePath: string = configPath): LoadedTicketsConfig {
	return loadTicketsConfig(filePath);
}

export function getLoadedTicketsConfig(): LoadedTicketsConfig | null {
	return cached;
}

function appliesToGuild(guildId: string): boolean {
	if (!cached) return false;
	const configured = cached.settings.guildId;
	return !configured || configured === guildId;
}

export function getTicketSettingsFromConfig(guildId: string): TicketSettings | null {
	if (!cached || !appliesToGuild(guildId)) return null;
	return cached.settings;
}

export function getGuildCategoriesFromConfig(guildId: string): TicketCategoryData[] {
	if (!cached || !appliesToGuild(guildId)) return [];
	return cached.categories.filter((category) => category.enabled);
}

export function getCategoryByIdFromConfig(guildId: string, categoryId: string): TicketCategoryData | null {
	return getGuildCategoriesFromConfig(guildId).find((c) => c.categoryId === categoryId) ?? null;
}
