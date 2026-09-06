import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import mysql from 'mysql2/promise';
import * as schema from '../db/schema.js';

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
	throw new Error('DATABASE_URL is required (MySQL connection string, e.g. mysql://user:pass@host:3306/erica)');
}

const pool = mysql.createPool({
	uri: databaseUrl,
	waitForConnections: true,
	connectionLimit: 10,
	enableKeepAlive: true,
});

export const db = drizzle(pool, { schema, mode: 'default' });

await migrate(db, { migrationsFolder: resolve('./drizzle') });

export async function closeDatabase(): Promise<void> {
	await pool.end();
}

export { schema };
