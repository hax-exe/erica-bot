#!/usr/bin/env bun
/**
 * One-time data migration: SQLite → MySQL.
 *
 * Prerequisites:
 *   1. Point DATABASE_URL at an empty (or wipeable) MySQL database.
 *   2. Apply schema: `bun src/migrate.ts` (or `bun run db:migrate`).
 *   3. Stop the bot before running this script.
 *
 * Usage:
 *   DATABASE_URL=mysql://user:pass@host:3306/erica \
 *   SQLITE_PATH=./data/erica.db \
 *     bun scripts/migrate-sqlite-to-mysql.ts
 *
 * Optional:
 *   SQLITE_PATH  — source SQLite file (default: DATABASE_PATH or ./data/erica.db)
 *   TRUNCATE=1   — truncate MySQL tables before import (default: 1)
 */

import { Database } from 'bun:sqlite';
import { resolve } from 'node:path';
import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL?.trim();
const SQLITE_PATH = resolve(process.env.SQLITE_PATH ?? process.env.DATABASE_PATH ?? './data/erica.db');
const SHOULD_TRUNCATE = (process.env.TRUNCATE ?? '1') !== '0';

if (!DATABASE_URL) {
	console.error('Error: DATABASE_URL is required (MySQL).');
	process.exit(1);
}

const TABLES = [
	'guilds',
	'guild_modules',
	'global_modules',
	'maintenance_state',
	'infractions',
	'mod_notes',
	'moderation_presets',
	'support_blacklist',
	'bot_blacklist',
	'tickets',
	'ticket_reviews',
	'review_settings',
	'welcome_settings',
	'leave_settings',
	'rr_panels',
	'rr_panel_roles',
	'starboard_settings',
	'starboard_entries',
	'birthday_settings',
	'birthdays',
	'space_settings',
	'active_spaces',
	'tags',
	'autoresponders',
	'xp',
	'level_settings',
	'level_roles',
	'level_badges',
	'preset_badge_roles',
	'incidents',
	'status_subscribers',
	'service_overrides',
	'status_checks',
	'status_panel',
	'minecraft_links',
	'pending_verifications',
	'sticky_messages',
	'automod_settings',
	'automod_word_filter',
	'suggestion_settings',
	'suggestions',
	'suggestion_votes',
	'counting_settings',
	'giveaways',
	'afk_statuses',
	'reminders',
	'stats_channels',
	'economy',
	'tempbans',
	'warn_escalation',
	'trivia_scores',
	'shop_items',
	'economy_transactions',
	'user_inventory',
	'boost_settings',
	'timed_roles',
	'auto_roles',
	'music_playlists',
	'anti_raid_settings',
	'music_queues',
	'social_feeds',
	'honeypot_channels',
] as const;

type MySqlColumn = { Field: string; Type: string };

function isBooleanType(type: string): boolean {
	const t = type.toLowerCase();
	return t.startsWith('tinyint(1)') || t === 'boolean' || t === 'bool';
}

function isDateTimeType(type: string): boolean {
	const t = type.toLowerCase();
	return t.startsWith('datetime') || t.startsWith('timestamp') || t.startsWith('date');
}

/** SQLite stored unix seconds (or ms if > 1e12) → JS Date for MySQL DATETIME. */
function toDate(value: unknown): Date | null {
	if (value == null) return null;
	if (value instanceof Date) return value;
	if (typeof value === 'string') {
		const d = new Date(value);
		return Number.isNaN(d.getTime()) ? null : d;
	}
	if (typeof value === 'number') {
		const ms = value > 1e12 ? value : value * 1000;
		return new Date(ms);
	}
	return null;
}

function toBool(value: unknown): number | null {
	if (value == null) return null;
	if (typeof value === 'boolean') return value ? 1 : 0;
	if (typeof value === 'number') return value ? 1 : 0;
	if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true' ? 1 : 0;
	return 0;
}

async function main() {
	console.log(`[migrate] SQLite source: ${SQLITE_PATH}`);
	console.log(`[migrate] MySQL target:  ${DATABASE_URL.replace(/:[^:@/]+@/, ':***@')}`);

	const sqlite = new Database(SQLITE_PATH, { readonly: true });
	const pool = mysql.createPool({ uri: DATABASE_URL, multipleStatements: false });

	try {
		const existingSqlite = new Set(
			(sqlite.query(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[]).map(
				(r) => r.name,
			),
		);

		for (const table of TABLES) {
			if (!existingSqlite.has(table)) {
				console.log(`[skip] ${table} (not in SQLite)`);
				continue;
			}

			let cols: MySqlColumn[];
			try {
				const [colRows] = await pool.query(`SHOW COLUMNS FROM \`${table}\``);
				cols = colRows as MySqlColumn[];
			} catch {
				console.log(`[skip] ${table} (missing in MySQL — run bun src/migrate.ts first)`);
				continue;
			}

			if (cols.length === 0) {
				console.log(`[skip] ${table} (no columns)`);
				continue;
			}

			const rows = sqlite.query(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[];
			console.log(`[table] ${table}: ${rows.length} row(s)`);
			if (rows.length === 0) continue;

			if (SHOULD_TRUNCATE) {
				await pool.query('SET FOREIGN_KEY_CHECKS=0');
				await pool.query(`TRUNCATE TABLE \`${table}\``);
				await pool.query('SET FOREIGN_KEY_CHECKS=1');
			}

			const colNames = cols.map((c) => c.Field);
			const placeholders = colNames.map(() => '?').join(', ');
			const quoted = colNames.map((c) => `\`${c}\``).join(', ');
			const insertSql = `INSERT INTO \`${table}\` (${quoted}) VALUES (${placeholders})`;

			const conn = await pool.getConnection();
			try {
				await conn.beginTransaction();
				for (const row of rows) {
					const values = cols.map((col) => {
						const raw = row[col.Field];
						if (isBooleanType(col.Type)) return toBool(raw);
						if (isDateTimeType(col.Type)) return toDate(raw);
						return raw ?? null;
					});
					await conn.query(insertSql, values);
				}
				await conn.commit();
			} catch (err) {
				await conn.rollback();
				throw err;
			} finally {
				conn.release();
			}

			console.log(`[ok]   ${table}`);
		}

		for (const table of TABLES) {
			if (!existingSqlite.has(table)) continue;
			try {
				const [colRows] = await pool.query(`SHOW COLUMNS FROM \`${table}\``);
				const hasId = (colRows as MySqlColumn[]).some((c) => c.Field === 'id');
				if (!hasId) continue;
				const [maxRows] = await pool.query(`SELECT COALESCE(MAX(id), 0) AS m FROM \`${table}\``);
				const maxId = Number((maxRows as { m: number }[])[0]?.m ?? 0);
				await pool.query(`ALTER TABLE \`${table}\` AUTO_INCREMENT = ${maxId + 1}`);
			} catch {
				// table may not exist
			}
		}

		console.log('[migrate] Complete.');
	} finally {
		sqlite.close();
		await pool.end();
	}
}

main().catch((err) => {
	console.error('[migrate] Failed:', err);
	process.exit(1);
});
