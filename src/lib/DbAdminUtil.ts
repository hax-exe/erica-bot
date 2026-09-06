import { container } from '@sapphire/framework';
import { AttachmentBuilder, type InteractionEditReplyOptions } from 'discord.js';
import { and, type Column, count, desc, eq, getTableColumns, getTableName, like, type SQL } from 'drizzle-orm';
import type { MySqlTable } from 'drizzle-orm/mysql-core';
import * as schema from '../db/schema.js';
import { db } from './database.js';

export type ColumnMeta = {
	/** Drizzle / JS property name (camelCase) */
	key: string;
	/** SQL column name */
	sqlName: string;
	column: Column;
	dataType: string;
	columnType: string;
	notNull: boolean;
	primary: boolean;
	hasDefault: boolean;
};

export type TableMeta = {
	/** SQL table name */
	name: string;
	table: MySqlTable;
	columns: ColumnMeta[];
	primaryKey: ColumnMeta[];
};

const MAX_LIST = 50;
const DEFAULT_LIST = 20;
const MAX_EXPORT = 2000;
const MAX_SEARCH = 50;
const INLINE_LIMIT = 1900;

function isMySqlTable(value: unknown): value is MySqlTable {
	try {
		getTableName(value as MySqlTable);
		return true;
	} catch {
		return false;
	}
}

function buildRegistry(): Map<string, TableMeta> {
	const map = new Map<string, TableMeta>();
	for (const value of Object.values(schema)) {
		if (!isMySqlTable(value)) continue;
		const name = getTableName(value);
		const cols = getTableColumns(value);
		const columns: ColumnMeta[] = Object.entries(cols).map(([key, column]) => ({
			key,
			sqlName: column.name,
			column: column as Column,
			dataType: column.dataType,
			columnType: column.columnType,
			notNull: column.notNull,
			primary: Boolean(column.primary),
			hasDefault: column.hasDefault,
		}));
		const primaryKey = columns.filter((c) => c.primary);
		if (primaryKey.length === 0) continue;
		map.set(name, { name, table: value, columns, primaryKey });
	}
	return map;
}

export const TABLE_REGISTRY: Map<string, TableMeta> = buildRegistry();

export function listTableNames(): string[] {
	return [...TABLE_REGISTRY.keys()].sort((a, b) => a.localeCompare(b));
}

export function resolveTable(name: string): TableMeta {
	const meta = TABLE_REGISTRY.get(name.trim());
	if (!meta) {
		throw new Error(`Unknown table \`${name}\`. Use \`/admin db tables\` for the whitelist.`);
	}
	return meta;
}

export function resolveColumn(meta: TableMeta, columnName: string): ColumnMeta {
	const needle = columnName.trim();
	const col =
		meta.columns.find((c) => c.key === needle || c.sqlName === needle) ??
		meta.columns.find(
			(c) => c.key.toLowerCase() === needle.toLowerCase() || c.sqlName.toLowerCase() === needle.toLowerCase(),
		);
	if (!col) {
		throw new Error(`Unknown column \`${columnName}\` on \`${meta.name}\`.`);
	}
	return col;
}

export function autocompleteTables(focused: string): { name: string; value: string }[] {
	const q = focused.trim().toLowerCase();
	const names = listTableNames().filter((n) => !q || n.includes(q));
	return names.slice(0, 25).map((n) => ({ name: n, value: n }));
}

export function autocompleteColumns(
	tableName: string,
	focused: string,
	opts?: { excludePk?: boolean },
): { name: string; value: string }[] {
	let meta: TableMeta;
	try {
		meta = resolveTable(tableName);
	} catch {
		return [];
	}
	const q = focused.trim().toLowerCase();
	let cols = meta.columns;
	if (opts?.excludePk) cols = cols.filter((c) => !c.primary);
	return cols
		.filter((c) => !q || c.key.toLowerCase().includes(q) || c.sqlName.toLowerCase().includes(q))
		.slice(0, 25)
		.map((c) => ({
			name: `${c.key} (${c.columnType.replace(/^MySql/, '')}${c.notNull ? '' : '?'})`,
			value: c.key,
		}));
}

/** Coerce a Discord string option into a JS value for the column. Literal `null` → null. */
export function coerceValue(col: ColumnMeta, raw: string): unknown {
	const trimmed = raw.trim();
	if (trimmed.toLowerCase() === 'null') {
		if (col.notNull && !col.hasDefault) {
			throw new Error(`Column \`${col.key}\` is NOT NULL.`);
		}
		return null;
	}

	const dt = col.dataType;
	const ct = col.columnType;

	if (dt === 'boolean' || ct === 'MySqlBoolean') {
		const v = trimmed.toLowerCase();
		if (v === 'true' || v === '1' || v === 'yes') return true;
		if (v === 'false' || v === '0' || v === 'no') return false;
		throw new Error(`Invalid boolean for \`${col.key}\` — use true/false.`);
	}

	if (dt === 'number' || ct === 'MySqlInt' || ct === 'MySqlBigInt53' || ct === 'MySqlFloat' || ct === 'MySqlDouble') {
		const n = Number(trimmed);
		if (!Number.isFinite(n)) throw new Error(`Invalid number for \`${col.key}\`.`);
		return Number.isInteger(n) && !ct.includes('Float') && !ct.includes('Double') ? Math.trunc(n) : n;
	}

	if (dt === 'date' || ct.includes('Date') || ct.includes('Time')) {
		if (/^\d+$/.test(trimmed)) {
			const ms = Number(trimmed);
			const d = new Date(ms < 1e12 ? ms * 1000 : ms);
			if (Number.isNaN(d.getTime())) throw new Error(`Invalid unix timestamp for \`${col.key}\`.`);
			return d;
		}
		const d = new Date(trimmed);
		if (Number.isNaN(d.getTime())) throw new Error(`Invalid datetime for \`${col.key}\` — use ISO or unix ms.`);
		return d;
	}

	return trimmed;
}

/**
 * Parse primary key from slash option.
 * Single PK: raw value. Composite: JSON object of column keys.
 */
export function parseKey(meta: TableMeta, keyRaw: string): Record<string, unknown> {
	const trimmed = keyRaw.trim();
	if (meta.primaryKey.length === 1) {
		const pk = meta.primaryKey[0]!;
		return { [pk.key]: coerceValue(pk, trimmed) };
	}

	let obj: unknown;
	try {
		obj = JSON.parse(trimmed);
	} catch {
		throw new Error(
			`Composite PK on \`${meta.name}\` — pass JSON like \`{${meta.primaryKey.map((c) => `"${c.key}":"..."`).join(',')}}\`.`,
		);
	}
	if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
		throw new Error('Composite PK key must be a JSON object.');
	}

	const record = obj as Record<string, unknown>;
	const out: Record<string, unknown> = {};
	for (const pk of meta.primaryKey) {
		const raw = record[pk.key] ?? record[pk.sqlName];
		if (raw === undefined) {
			throw new Error(`Missing PK field \`${pk.key}\` in key JSON.`);
		}
		out[pk.key] = typeof raw === 'string' ? coerceValue(pk, raw) : coerceValue(pk, String(raw));
	}
	return out;
}

function pkWhere(meta: TableMeta, key: Record<string, unknown>): SQL {
	const parts = meta.primaryKey.map((pk) => eq(pk.column as any, key[pk.key]));
	return parts.length === 1 ? parts[0]! : and(...parts)!;
}

export function formatPkHint(meta: TableMeta): string {
	if (meta.primaryKey.length === 1) return meta.primaryKey[0]!.key;
	return `{${meta.primaryKey.map((c) => c.key).join(', ')}}`;
}

function serializeRow(row: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(row)) {
		if (v instanceof Date) out[k] = v.toISOString();
		else out[k] = v;
	}
	return out;
}

export function formatRowsJson(rows: Record<string, unknown>[]): string {
	return JSON.stringify(rows.map(serializeRow), null, 2);
}

/** Build ephemeral reply: inline code block or file attachment when large. */
export function buildResultReply(title: string, body: string, filename = 'rows.json'): InteractionEditReplyOptions {
	const header = `**${title}**\n`;
	const lang = filename.endsWith('.json') ? 'json' : '';
	const fenced = lang ? `${header}\`\`\`${lang}\n${body}\n\`\`\`` : `${header}${body}`;
	if (fenced.length <= INLINE_LIMIT) {
		return { content: fenced };
	}
	return {
		content: `${header}-# Result attached (${body.length} chars).`,
		files: [new AttachmentBuilder(Buffer.from(body, 'utf8'), { name: filename })],
	};
}

export async function listRows(
	tableName: string,
	opts: { limit?: number; filterColumn?: string | null; filterValue?: string | null } = {},
): Promise<{ meta: TableMeta; rows: Record<string, unknown>[] }> {
	const meta = resolveTable(tableName);
	const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIST, 1), MAX_LIST);

	let query = db
		.select()
		.from(meta.table as any)
		.$dynamic();
	if (opts.filterColumn && opts.filterValue != null) {
		const col = resolveColumn(meta, opts.filterColumn);
		const value = coerceValue(col, opts.filterValue);
		query = query.where(eq(col.column as any, value)) as typeof query;
	}

	const rows = (await query.limit(limit)) as Record<string, unknown>[];
	return { meta, rows };
}

export async function getRow(
	tableName: string,
	keyRaw: string,
): Promise<{ meta: TableMeta; row: Record<string, unknown> }> {
	const meta = resolveTable(tableName);
	const key = parseKey(meta, keyRaw);
	const rows = (await db
		.select()
		.from(meta.table as any)
		.where(pkWhere(meta, key))
		.limit(1)) as Record<string, unknown>[];
	const row = rows[0];
	if (!row) throw new Error(`No row in \`${meta.name}\` for key \`${keyRaw}\`.`);
	return { meta, row };
}

export async function setColumn(
	tableName: string,
	keyRaw: string,
	columnName: string,
	valueRaw: string,
	actorId: string,
): Promise<{ meta: TableMeta; row: Record<string, unknown> }> {
	const meta = resolveTable(tableName);
	const col = resolveColumn(meta, columnName);
	if (col.primary) {
		throw new Error(`Cannot change primary key column \`${col.key}\` via set — delete and re-insert.`);
	}
	const key = parseKey(meta, keyRaw);
	const value = coerceValue(col, valueRaw);

	const result = await db
		.update(meta.table as any)
		.set({ [col.key]: value })
		.where(pkWhere(meta, key));
	const affected = Number((result as any)[0]?.affectedRows ?? 0);
	if (affected === 0) throw new Error(`No row in \`${meta.name}\` for key \`${keyRaw}\`.`);

	container.logger.warn(`[DbAdmin] set ${meta.name}.${col.key}=${JSON.stringify(value)} key=${keyRaw} by ${actorId}`);

	const { row } = await getRow(tableName, keyRaw);
	return { meta, row };
}

export async function insertRow(
	tableName: string,
	dataRaw: string,
	actorId: string,
): Promise<{ meta: TableMeta; row: Record<string, unknown> | null; insertId?: number }> {
	const meta = resolveTable(tableName);
	let parsed: unknown;
	try {
		parsed = JSON.parse(dataRaw);
	} catch {
		throw new Error('`data` must be a JSON object of column → value.');
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('`data` must be a JSON object of column → value.');
	}

	const input = parsed as Record<string, unknown>;
	const values: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(input)) {
		const col = resolveColumn(meta, k);
		if (v === null) {
			values[col.key] = coerceValue(col, 'null');
		} else if (typeof v === 'string') {
			values[col.key] = coerceValue(col, v);
		} else if (typeof v === 'number' || typeof v === 'boolean') {
			values[col.key] = v;
		} else if (typeof v === 'object') {
			values[col.key] = coerceValue(col, JSON.stringify(v));
		} else {
			values[col.key] = coerceValue(col, String(v));
		}
	}

	const result = await db.insert(meta.table as any).values(values);
	const header = (result as any)[0] as { insertId?: number; affectedRows?: number } | undefined;
	const insertId = header?.insertId;

	container.logger.warn(`[DbAdmin] insert ${meta.name} values=${JSON.stringify(values)} by ${actorId}`);

	// Prefer fetch by provided PK, else by insertId when single autoincrement int PK
	try {
		if (meta.primaryKey.length === 1 && values[meta.primaryKey[0]!.key] != null) {
			const keyRaw =
				meta.primaryKey.length === 1
					? String(values[meta.primaryKey[0]!.key])
					: JSON.stringify(Object.fromEntries(meta.primaryKey.map((pk) => [pk.key, values[pk.key]])));
			const { row } = await getRow(tableName, keyRaw);
			return { meta, row, insertId };
		}
		if (meta.primaryKey.length === 1 && insertId != null && insertId > 0) {
			const { row } = await getRow(tableName, String(insertId));
			return { meta, row, insertId };
		}
		if (meta.primaryKey.every((pk) => values[pk.key] != null)) {
			const keyRaw = JSON.stringify(Object.fromEntries(meta.primaryKey.map((pk) => [pk.key, values[pk.key]])));
			const { row } = await getRow(tableName, keyRaw);
			return { meta, row, insertId };
		}
	} catch {
		/* row fetch optional after insert */
	}

	return { meta, row: null, insertId };
}

export async function deleteRow(
	tableName: string,
	keyRaw: string,
	actorId: string,
): Promise<{ meta: TableMeta; deleted: Record<string, unknown> }> {
	const meta = resolveTable(tableName);
	const { row } = await getRow(tableName, keyRaw);
	const key = parseKey(meta, keyRaw);

	const result = await db.delete(meta.table as any).where(pkWhere(meta, key));
	const affected = Number((result as any)[0]?.affectedRows ?? 0);
	if (affected === 0) throw new Error(`No row in \`${meta.name}\` for key \`${keyRaw}\`.`);

	container.logger.warn(`[DbAdmin] delete ${meta.name} key=${keyRaw} by ${actorId}`);
	return { meta, deleted: row };
}

function escapeLike(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function buildEqualityFilter(
	meta: TableMeta,
	filterColumn?: string | null,
	filterValue?: string | null,
): SQL | undefined {
	if (!filterColumn) return undefined;
	if (filterValue == null) throw new Error('Provide `filter_value` when using `filter_column`.');
	const col = resolveColumn(meta, filterColumn);
	return eq(col.column as any, coerceValue(col, filterValue));
}

export async function countRows(
	tableName: string,
	opts: { filterColumn?: string | null; filterValue?: string | null } = {},
): Promise<{ meta: TableMeta; count: number }> {
	const meta = resolveTable(tableName);
	const where = buildEqualityFilter(meta, opts.filterColumn, opts.filterValue);
	let query = db
		.select({ value: count() })
		.from(meta.table as any)
		.$dynamic();
	if (where) query = query.where(where) as typeof query;
	const [row] = await query;
	return { meta, count: Number(row?.value ?? 0) };
}

export async function searchRows(
	tableName: string,
	columnName: string,
	query: string,
	opts: { limit?: number } = {},
): Promise<{ meta: TableMeta; rows: Record<string, unknown>[] }> {
	const meta = resolveTable(tableName);
	const col = resolveColumn(meta, columnName);
	if (col.dataType !== 'string' && !col.columnType.includes('Text') && !col.columnType.includes('VarChar')) {
		throw new Error(`Column \`${col.key}\` is not a text column — search needs varchar/text.`);
	}
	const q = query.trim();
	if (!q) throw new Error('Search query cannot be empty.');
	const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIST, 1), MAX_SEARCH);
	const pattern = `%${escapeLike(q)}%`;
	const rows = (await db
		.select()
		.from(meta.table as any)
		.where(like(col.column as any, pattern))
		.limit(limit)) as Record<string, unknown>[];
	return { meta, rows };
}

export async function exportRows(
	tableName: string,
	opts: { limit?: number; filterColumn?: string | null; filterValue?: string | null } = {},
): Promise<{ meta: TableMeta; rows: Record<string, unknown>[]; truncated: boolean }> {
	const meta = resolveTable(tableName);
	const limit = Math.min(Math.max(opts.limit ?? MAX_EXPORT, 1), MAX_EXPORT);
	const where = buildEqualityFilter(meta, opts.filterColumn, opts.filterValue);
	let query = db
		.select()
		.from(meta.table as any)
		.$dynamic();
	if (where) query = query.where(where) as typeof query;
	const rows = (await query.limit(limit + 1)) as Record<string, unknown>[];
	const truncated = rows.length > limit;
	return { meta, rows: truncated ? rows.slice(0, limit) : rows, truncated };
}

export async function tableStats(): Promise<{ name: string; count: number; pk: string }[]> {
	const out: { name: string; count: number; pk: string }[] = [];
	for (const name of listTableNames()) {
		const meta = resolveTable(name);
		const [row] = await db.select({ value: count() }).from(meta.table as any);
		out.push({ name, count: Number(row?.value ?? 0), pk: formatPkHint(meta) });
	}
	return out;
}

export async function cloneRow(
	tableName: string,
	keyRaw: string,
	actorId: string,
	overridesRaw?: string | null,
): Promise<{ meta: TableMeta; row: Record<string, unknown> | null; insertId?: number }> {
	const { meta, row } = await getRow(tableName, keyRaw);
	const values: Record<string, unknown> = { ...serializeRow(row) };

	// Drop autoincrement / primary keys that have defaults so MySQL allocates a new id
	for (const pk of meta.primaryKey) {
		if (pk.hasDefault || pk.dataType === 'number') {
			delete values[pk.key];
		}
	}

	if (overridesRaw?.trim()) {
		let overrides: unknown;
		try {
			overrides = JSON.parse(overridesRaw);
		} catch {
			throw new Error('`overrides` must be a JSON object.');
		}
		if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
			throw new Error('`overrides` must be a JSON object.');
		}
		for (const [k, v] of Object.entries(overrides as Record<string, unknown>)) {
			const col = resolveColumn(meta, k);
			if (v === null) values[col.key] = coerceValue(col, 'null');
			else if (typeof v === 'string') values[col.key] = coerceValue(col, v);
			else if (typeof v === 'number' || typeof v === 'boolean') values[col.key] = v;
			else values[col.key] = coerceValue(col, JSON.stringify(v));
		}
	}

	// Re-coerce Date ISO strings from serializeRow back to Date for datetime cols
	for (const col of meta.columns) {
		if (!(col.key in values)) continue;
		const v = values[col.key];
		if (typeof v === 'string' && (col.dataType === 'date' || col.columnType.includes('Date'))) {
			values[col.key] = coerceValue(col, v);
		}
	}

	const result = await db.insert(meta.table as any).values(values);
	const header = (result as any)[0] as { insertId?: number } | undefined;
	const insertId = header?.insertId;
	container.logger.warn(`[DbAdmin] clone ${meta.name} from=${keyRaw} by ${actorId}`);

	if (meta.primaryKey.length === 1 && insertId != null && insertId > 0) {
		const { row: created } = await getRow(tableName, String(insertId));
		return { meta, row: created, insertId };
	}
	if (meta.primaryKey.every((pk) => values[pk.key] != null)) {
		const key =
			meta.primaryKey.length === 1
				? String(values[meta.primaryKey[0]!.key])
				: JSON.stringify(Object.fromEntries(meta.primaryKey.map((pk) => [pk.key, values[pk.key]])));
		const { row: created } = await getRow(tableName, key);
		return { meta, row: created, insertId };
	}
	return { meta, row: null, insertId };
}

export async function patchRow(
	tableName: string,
	keyRaw: string,
	dataRaw: string,
	actorId: string,
): Promise<{ meta: TableMeta; row: Record<string, unknown> }> {
	const meta = resolveTable(tableName);
	let parsed: unknown;
	try {
		parsed = JSON.parse(dataRaw);
	} catch {
		throw new Error('`data` must be a JSON object of column → value.');
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('`data` must be a JSON object of column → value.');
	}

	const patch: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
		const col = resolveColumn(meta, k);
		if (col.primary) throw new Error(`Cannot patch primary key \`${col.key}\`.`);
		if (v === null) patch[col.key] = coerceValue(col, 'null');
		else if (typeof v === 'string') patch[col.key] = coerceValue(col, v);
		else if (typeof v === 'number' || typeof v === 'boolean') patch[col.key] = v;
		else patch[col.key] = coerceValue(col, JSON.stringify(v));
	}
	if (Object.keys(patch).length === 0) throw new Error('Patch object is empty.');

	const key = parseKey(meta, keyRaw);
	const result = await db
		.update(meta.table as any)
		.set(patch)
		.where(pkWhere(meta, key));
	const affected = Number((result as any)[0]?.affectedRows ?? 0);
	if (affected === 0) throw new Error(`No row in \`${meta.name}\` for key \`${keyRaw}\`.`);

	container.logger.warn(
		`[DbAdmin] patch ${meta.name} key=${keyRaw} fields=${Object.keys(patch).join(',')} by ${actorId}`,
	);
	const { row } = await getRow(tableName, keyRaw);
	return { meta, row };
}

export async function bulkSet(
	tableName: string,
	columnName: string,
	valueRaw: string,
	actorId: string,
	opts: { filterColumn?: string | null; filterValue?: string | null; confirmAll?: boolean } = {},
): Promise<{ meta: TableMeta; affected: number }> {
	const meta = resolveTable(tableName);
	const col = resolveColumn(meta, columnName);
	if (col.primary) throw new Error(`Cannot bulk-set primary key \`${col.key}\`.`);
	const value = coerceValue(col, valueRaw);
	const where = buildEqualityFilter(meta, opts.filterColumn, opts.filterValue);
	if (!where && !opts.confirmAll) {
		throw new Error('Refusing whole-table update — pass a filter, or set `confirm_all` to true.');
	}

	const result = where
		? await db
				.update(meta.table as any)
				.set({ [col.key]: value })
				.where(where)
		: await db.update(meta.table as any).set({ [col.key]: value });
	const affected = Number((result as any)[0]?.affectedRows ?? 0);
	container.logger.warn(
		`[DbAdmin] bulkset ${meta.name}.${col.key}=${JSON.stringify(value)} filter=${opts.filterColumn ?? '*'} affected=${affected} by ${actorId}`,
	);
	return { meta, affected };
}

export async function purgeRows(
	tableName: string,
	actorId: string,
	opts: { filterColumn?: string | null; filterValue?: string | null; confirmAll?: boolean } = {},
): Promise<{ meta: TableMeta; affected: number }> {
	const meta = resolveTable(tableName);
	const where = buildEqualityFilter(meta, opts.filterColumn, opts.filterValue);
	if (!where && !opts.confirmAll) {
		throw new Error('Refusing whole-table delete — pass a filter, or set `confirm_all` to true.');
	}

	const result = where ? await db.delete(meta.table as any).where(where) : await db.delete(meta.table as any);
	const affected = Number((result as any)[0]?.affectedRows ?? 0);
	container.logger.warn(
		`[DbAdmin] purge ${meta.name} filter=${opts.filterColumn ?? '*'} affected=${affected} by ${actorId}`,
	);
	return { meta, affected };
}

/** Newest rows when a createdAt / created_at-style column exists. */
export async function recentRows(
	tableName: string,
	opts: { limit?: number } = {},
): Promise<{ meta: TableMeta; rows: Record<string, unknown>[]; orderColumn: string }> {
	const meta = resolveTable(tableName);
	const orderCol =
		meta.columns.find((c) => c.key === 'createdAt' || c.sqlName === 'created_at') ??
		meta.columns.find((c) => c.key === 'updatedAt' || c.sqlName === 'updated_at') ??
		meta.columns.find((c) => c.dataType === 'date' || c.columnType.includes('Date'));
	if (!orderCol) {
		throw new Error(`Table \`${meta.name}\` has no datetime column to order by.`);
	}
	const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIST, 1), MAX_LIST);
	const rows = (await db
		.select()
		.from(meta.table as any)
		.orderBy(desc(orderCol.column as any))
		.limit(limit)) as Record<string, unknown>[];
	return { meta, rows, orderColumn: orderCol.key };
}
