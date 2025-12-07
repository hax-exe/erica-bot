import { pool } from './index.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('transactions');

/**
 * Execute a callback function within a database transaction.
 * Automatically commits on success and rolls back on failure.
 */
export async function withTransaction<T>(
    callback: (client: import('pg').PoolClient) => Promise<T>
): Promise<T> {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error({ error }, 'Transaction rolled back');
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Atomically update a user's balance if they have sufficient funds.
 * Returns the new balance if successful, null if insufficient funds.
 */
export async function atomicBalanceUpdate(
    guildId: string,
    userId: string,
    amount: number
): Promise<{ success: boolean; newBalance: number } | null> {
    const client = await pool.connect();

    try {
        // Use a single atomic query that checks and updates balance
        const result = await client.query(
            `UPDATE guild_members 
             SET balance = balance + $1, updated_at = NOW()
             WHERE guild_id = $2 AND user_id = $3 
             AND balance + $1 >= 0
             RETURNING balance`,
            [amount, guildId, userId]
        );

        if (result.rows.length === 0) {
            return null; // Insufficient balance or user not found
        }

        return {
            success: true,
            newBalance: result.rows[0].balance,
        };
    } finally {
        client.release();
    }
}

/**
 * Atomically check and update a cooldown timestamp.
 * Returns true if the cooldown has passed and was updated, false if still on cooldown.
 */
export async function atomicCooldownCheck(
    guildId: string,
    userId: string,
    cooldownField: 'last_daily' | 'last_work',
    cooldownSeconds: number
): Promise<{ success: boolean; newTimestamp: Date } | { success: false; timeLeft: number }> {
    const client = await pool.connect();

    try {
        const result = await client.query(
            `UPDATE guild_members 
             SET ${cooldownField} = NOW(), updated_at = NOW()
             WHERE guild_id = $1 AND user_id = $2 
             AND (${cooldownField} IS NULL OR ${cooldownField} < NOW() - INTERVAL '${cooldownSeconds} seconds')
             RETURNING ${cooldownField}`,
            [guildId, userId]
        );

        if (result.rows.length > 0) {
            return {
                success: true,
                newTimestamp: result.rows[0][cooldownField],
            };
        }

        // Get remaining cooldown time
        const timeResult = await client.query(
            `SELECT EXTRACT(EPOCH FROM (${cooldownField} + INTERVAL '${cooldownSeconds} seconds' - NOW())) as time_left
             FROM guild_members 
             WHERE guild_id = $1 AND user_id = $2`,
            [guildId, userId]
        );

        const timeLeft = timeResult.rows[0]?.time_left ?? cooldownSeconds;

        return {
            success: false,
            timeLeft: Math.max(0, Math.ceil(timeLeft)),
        };
    } finally {
        client.release();
    }
}

/**
 * Atomically transfer balance between two users within a transaction.
 * Returns success status and new balances.
 */
export async function atomicTransfer(
    guildId: string,
    senderId: string,
    receiverId: string,
    amount: number
): Promise<{ success: boolean; senderBalance?: number; receiverBalance?: number; error?: string }> {
    return withTransaction(async (client) => {
        // First, try to debit the sender atomically
        const debitResult = await client.query(
            `UPDATE guild_members 
             SET balance = balance - $1, updated_at = NOW()
             WHERE guild_id = $2 AND user_id = $3 
             AND balance >= $1
             RETURNING balance`,
            [amount, guildId, senderId]
        );

        if (debitResult.rows.length === 0) {
            return { success: false, error: 'Insufficient balance' };
        }

        // Credit the receiver (upsert)
        const creditResult = await client.query(
            `INSERT INTO guild_members (guild_id, user_id, balance, created_at, updated_at)
             VALUES ($1, $2, $3, NOW(), NOW())
             ON CONFLICT (guild_id, user_id) 
             DO UPDATE SET balance = guild_members.balance + $3, updated_at = NOW()
             RETURNING balance`,
            [guildId, receiverId, amount]
        );

        return {
            success: true,
            senderBalance: debitResult.rows[0].balance,
            receiverBalance: creditResult.rows[0].balance,
        };
    });
}
