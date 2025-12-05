import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import * as schema from './schema/index.js';

const logger = createLogger('database');

const pool = new pg.Pool({
    connectionString: config.database.url,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
    logger.error({ err }, 'Unexpected database pool error');
});

export const db = drizzle(pool, { schema });

export async function connectDatabase(): Promise<void> {
    try {
        const client = await pool.connect();
        logger.info('✅ Connected to PostgreSQL database');
        client.release();
    } catch (error) {
        logger.error({ error }, '❌ Failed to connect to database');
        throw error;
    }
}

export async function disconnectDatabase(): Promise<void> {
    await pool.end();
    logger.info('Database connection pool closed');
}

export { pool };
