#!/usr/bin/env bun
/**
 * One-time data migration: SQLite → PostgreSQL.
 *
 * Run AFTER setting DATABASE_URL in .env and AFTER the PostgreSQL schema has
 * been created (bun db:generate && bun db:migrate), but BEFORE starting the bot.
 *
 * Usage:
 *   SQLITE_PATH=./data/erica.db bun scripts/migrate-sqlite-to-postgres.ts
 *
 * SQLITE_PATH defaults to ./data/erica.db if not set.
 */

import { Database } from 'bun:sqlite';
import { resolve } from 'node:path';
import postgres from 'postgres';

const SQLITE_PATH = resolve(process.env.SQLITE_PATH ?? './data/erica.db');
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
	console.error('Error: DATABASE_URL environment variable is required.');
	process.exit(1);
}

const sqlite = new Database(SQLITE_PATH, { readonly: true });
const pg = postgres(DATABASE_URL);

// ─── Type mappings ─────────────────────────────────────────────────────────────

// SQLite stores booleans as 0/1 integers — map column names that need conversion.
const BOOLEAN_COLS: Record<string, string[]> = {
	welcome_settings: ['enabled', 'show_avatar'],
	leave_settings: ['enabled'],
	review_settings: ['enabled'],
	starboard_settings: ['enabled'],
	birthday_settings: ['enabled'],
	space_settings: ['enabled'],
	sticky_messages: ['enabled'],
	guild_modules: ['leveling', 'welcomer', 'starboard', 'birthdays', 'spaces', 'sticky', 'tickets', 'tags', 'logging', 'music', 'reaction_roles', 'reports', 'reviews', 'verification', 'automod'],
	global_modules: ['leveling', 'welcomer', 'starboard', 'birthdays', 'spaces', 'sticky', 'tickets', 'tags', 'logging', 'music', 'reaction_roles', 'reports', 'reviews', 'verification', 'automod'],
	status_checks: ['online'],
	level_settings: ['enabled', 'voice_xp_enabled'],
	ticket_settings: ['close_confirmation', 'dm_on_open', 'dm_on_close'],
	automod_settings: ['word_filter_enabled', 'spam_enabled', 'caps_enabled', 'link_enabled', 'invite_enabled', 'mention_enabled', 'new_account_enabled'],
	automod_word_filter: ['is_regex'],
};

// SQLite stores these as unix-ms integers; PostgreSQL timestamp columns need Date objects.
const TIMESTAMP_COLS: Record<string, string[]> = {
	infractions: ['created_at'],
	support_blacklist: ['created_at'],
	bot_blacklist: ['created_at'],
	tickets: ['created_at', 'closed_at'],
	ticket_reviews: ['created_at'],
	starboard_entries: ['created_at'],
	active_spaces: ['created_at'],
	tags: ['created_at'],
	status_checks: ['checked_at'],
	minecraft_links: ['linked_at'],
	pending_verifications: ['expires_at'],
	automod_word_filter: ['added_at'],
};

// Tables in safe insertion order (no FK constraints defined, but logical order is cleaner).
const TABLES = [
	'guilds',
	'guild_modules',
	'global_modules',
	'infractions',
	'bot_blacklist',
	'support_blacklist',
	'tickets',
	'ticket_settings',
	'ticket_categories',
	'ticket_reviews',
	'review_settings',
	'tags',
	'sticky_messages',
	'starboard_settings',
	'starboard_entries',
	'welcome_settings',
	'leave_settings',
	'birthdays',
	'birthday_settings',
	'minecraft_links',
	'pending_verifications',
	'xp',
	'level_settings',
	'level_roles',
	'level_badges',
	'preset_badge_roles',
	'rr_panels',
	'rr_panel_roles',
	'space_settings',
	'active_spaces',
	'automod_settings',
	'automod_word_filter',
	'status_checks',
	'status_panel',
];

// Serial (autoincrement) tables — sequences must be reset after import.
const SERIAL_TABLES = [
	'infractions',
	'support_blacklist',
	'tickets',
	'ticket_reviews',
	'ticket_categories',
	'tags',
	'starboard_entries',
	'birthdays',
	'xp',
	'level_roles',
	'level_badges',
	'preset_badge_roles',
	'rr_panels',
	'rr_panel_roles',
	'automod_word_filter',
	'status_checks',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

function transformRow(table: string, row: Row): Row {
	const boolCols = BOOLEAN_COLS[table] ?? [];
	const tsCols = TIMESTAMP_COLS[table] ?? [];
	const out: Row = {};
	for (const [k, v] of Object.entries(row)) {
		if (boolCols.includes(k)) {
			out[k] = v === 1 || v === true;
		} else if (tsCols.includes(k)) {
			out[k] = v != null ? new Date(v as number) : null;
		} else {
			out[k] = v;
		}
	}
	return out;
}

const CHUNK = 500;

async function migrateTable(table: string): Promise<void> {
	let rows: Row[];
	try {
		rows = sqlite.query(`SELECT * FROM "${table}"`).all() as Row[];
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes('no such table')) {
			console.log(`  ${table}: not found in SQLite, skipping`);
			return;
		}
		throw err;
	}

	if (rows.length === 0) {
		console.log(`  ${table}: empty`);
		return;
	}

	const transformed = rows.map((r) => transformRow(table, r));

	// Insert in chunks to avoid huge parameter lists.
	for (let i = 0; i < transformed.length; i += CHUNK) {
		const chunk = transformed.slice(i, i + CHUNK);
		await pg`INSERT INTO ${pg(table)} ${pg(chunk)} ON CONFLICT DO NOTHING`;
	}

	console.log(`  ${table}: ${rows.length} row(s)`);
}

async function resetSequences(): Promise<void> {
	for (const table of SERIAL_TABLES) {
		await pg.unsafe(
			`SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM "${table}"), 1))`,
		);
	}
	console.log('  sequences reset');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log(`SQLite → PostgreSQL migration`);
console.log(`  source : ${SQLITE_PATH}`);
console.log(`  target : ${DATABASE_URL.replace(/:\/\/[^@]+@/, '://<credentials>@')}`);
console.log('');

for (const table of TABLES) {
	await migrateTable(table);
}

console.log('');
await resetSequences();

await pg.end();
sqlite.close();

console.log('\nDone.');
