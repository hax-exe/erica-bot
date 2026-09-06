/**
 * Apply pending Drizzle MySQL migrations (used by Docker entrypoint).
 *
 * Requires DATABASE_URL=mysql://user:pass@host:3306/dbname
 */
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import mysql from 'mysql2/promise';
import * as schema from './db/schema.js';

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
	console.error('[migrate] DATABASE_URL is required.');
	process.exit(1);
}

const pool = mysql.createPool({
	uri: databaseUrl,
	waitForConnections: true,
	connectionLimit: 5,
});

const db = drizzle(pool, { schema, mode: 'default' });

try {
	console.log('[migrate] Applying pending MySQL migrations...');
	await migrate(db, { migrationsFolder: resolve('./drizzle') });
	console.log('[migrate] Done.');
} catch (error) {
	console.error('[migrate] Migration failed:', error);
	process.exit(1);
} finally {
	await pool.end();
}
