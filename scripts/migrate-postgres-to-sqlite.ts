#!/usr/bin/env bun
/**
 * One-time data migration: PostgreSQL → SQLite.
 *
 * Run AFTER the new SQLite database has been initialised (start the bot once
 * so database.ts runs migrations, then stop it), but BEFORE using the bot.
 *
 * Requires the postgres package — install it temporarily:
 *   bun add -d postgres
 *
 * Usage:
 *   DATABASE_URL=postgresql://... DATABASE_PATH=./data/erica.db \
 *     bun scripts/migrate-postgres-to-sqlite.ts
 *
 * DATABASE_PATH defaults to ./data/erica.db if not set.
 */

import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;
const SQLITE_PATH = resolve(process.env.DATABASE_PATH ?? './data/erica.db');

if (!DATABASE_URL) {
	console.error('Error: DATABASE_URL environment variable is required.');
	process.exit(1);
}

mkdirSync(dirname(SQLITE_PATH), { recursive: true });
const sqlite = new Database(SQLITE_PATH, { create: true });
sqlite.run('PRAGMA journal_mode = WAL');
sqlite.run('PRAGMA foreign_keys = OFF'); // off during bulk import

const pg = postgres(DATABASE_URL, { transform: postgres.toCamel });

// ─── Type mappings ─────────────────────────────────────────────────────────────

// Columns that are boolean in postgres → stored as 0/1 in SQLite
const BOOLEAN_COLS: Record<string, string[]> = {
	welcome_settings: ['enabled', 'show_avatar'],
	leave_settings: ['enabled'],
	review_settings: ['enabled'],
	starboard_settings: ['enabled'],
	birthday_settings: ['enabled'],
	space_settings: ['enabled'],
	sticky_messages: ['enabled'],
	ticket_settings: ['close_confirmation', 'dm_on_open', 'dm_on_close'],
	level_settings: ['enabled', 'voice_xp_enabled'],
	guild_modules: ['leveling', 'welcomer', 'starboard', 'birthdays', 'spaces', 'sticky', 'tickets', 'tags', 'logging', 'music', 'reaction_roles', 'reports', 'reviews', 'verification', 'automod', 'suggestions', 'counting', 'fun'],
	global_modules: ['leveling', 'welcomer', 'starboard', 'birthdays', 'spaces', 'sticky', 'tickets', 'tags', 'logging', 'music', 'reaction_roles', 'reports', 'reviews', 'verification', 'automod', 'suggestions', 'counting', 'fun'],
	maintenance_state: ['enabled'],
	status_checks: ['online'],
	automod_settings: ['word_filter_enabled', 'spam_enabled', 'caps_enabled', 'link_enabled', 'invite_enabled', 'mention_enabled', 'new_account_enabled'],
	automod_word_filter: ['is_regex'],
	suggestion_settings: ['dm_on_update'],
	infractions: ['untimeout_logged'],
	counting_settings: ['reset_on_fail', 'enabled'],
};

// Columns that are timestamps in postgres → stored as unix seconds in SQLite
const TIMESTAMP_COLS: Record<string, string[]> = {
	infractions: ['created_at'],
	support_blacklist: ['created_at'],
	bot_blacklist: ['created_at'],
	tickets: ['created_at', 'closed_at'],
	ticket_reviews: ['created_at'],
	starboard_entries: ['created_at'],
	active_spaces: ['created_at'],
	tags: ['created_at'],
	incidents: ['started_at', 'resolved_at'],
	status_subscribers: ['subscribed_at'],
	service_overrides: ['set_at'],
	status_checks: ['checked_at'],
	minecraft_links: ['linked_at'],
	pending_verifications: ['expires_at'],
	automod_word_filter: ['added_at'],
	suggestions: ['created_at'],
	maintenance_state: ['started_at'],
};

// Columns that are bigint in postgres → plain integer in SQLite
const BIGINT_COLS: Record<string, string[]> = {
	xp: ['last_message_at'],
	infractions: ['duration'],
};

// All tables to migrate — script gracefully skips any that don't exist in postgres
const TABLES = [
	'guilds',
	'guild_modules',
	'global_modules',
	'maintenance_state',
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
	'status_subscribers',
	'service_overrides',
	'incidents',
	'suggestion_settings',
	'suggestions',
	'suggestion_votes',
	'counting_settings',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

function toSnake(s: string): string {
	return s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

function transformRow(table: string, row: Row): Row {
	const boolCols = BOOLEAN_COLS[table] ?? [];
	const tsCols = TIMESTAMP_COLS[table] ?? [];
	const bigintCols = BIGINT_COLS[table] ?? [];
	const out: Row = {};

	for (const [camel, v] of Object.entries(row)) {
		const k = toSnake(camel); // postgres-js toCamel means we get camelCase keys

		if (v === null || v === undefined) {
			out[k] = null;
		} else if (boolCols.includes(k)) {
			out[k] = v === true || v === 1 ? 1 : 0;
		} else if (tsCols.includes(k)) {
			out[k] = v instanceof Date ? Math.floor(v.getTime() / 1000) : null;
		} else if (bigintCols.includes(k)) {
			out[k] = v != null ? Number(v) : null;
		} else {
			out[k] = v;
		}
	}

	return out;
}

function buildInsert(table: string, rows: Row[]): void {
	if (rows.length === 0) return;

	const cols = Object.keys(rows[0]);
	const colList = cols.map((c) => `"${c}"`).join(', ');
	const placeholders = cols.map((_, i) => `?${i + 1}`).join(', ');
	const stmt = sqlite.prepare(
		`INSERT OR IGNORE INTO "${table}" (${colList}) VALUES (${placeholders})`,
	);

	const insertMany = sqlite.transaction((batch: Row[]) => {
		for (const row of batch) {
			stmt.run(...cols.map((c) => row[c] ?? null));
		}
	});

	const CHUNK = 500;
	for (let i = 0; i < rows.length; i += CHUNK) {
		insertMany(rows.slice(i, i + CHUNK));
	}
}

async function migrateTable(table: string): Promise<void> {
	let pgRows: Row[];
	try {
		pgRows = (await pg.unsafe(`SELECT * FROM "${table}"`)) as Row[];
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes('does not exist') || msg.includes('relation') ) {
			console.log(`  ${table}: not found in postgres, skipping`);
			return;
		}
		throw err;
	}

	if (pgRows.length === 0) {
		console.log(`  ${table}: empty`);
		return;
	}

	const transformed = pgRows.map((r) => transformRow(table, r));

	try {
		buildInsert(table, transformed);
		console.log(`  ${table}: ${pgRows.length} row(s)`);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`  ${table}: ERROR — ${msg}`);
		console.error('  First row:', JSON.stringify(transformed[0], null, 2));
	}
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log('PostgreSQL → SQLite migration');
console.log(`  source : ${DATABASE_URL.replace(/:\/\/[^@]+@/, '://<credentials>@')}`);
console.log(`  target : ${SQLITE_PATH}`);
console.log('');

for (const table of TABLES) {
	await migrateTable(table);
}

sqlite.run('PRAGMA foreign_keys = ON');

await pg.end();
sqlite.close();

console.log('\nDone.');
