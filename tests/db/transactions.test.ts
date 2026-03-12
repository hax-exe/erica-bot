import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the database module
vi.mock('../../src/db/index.js', () => ({
    pool: {
        connect: vi.fn(),
    },
}));

// Mock the logger to avoid config side effects and to spy on log calls
vi.mock('../../src/utils/logger.js', () => ({
    createLogger: () => ({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    }),
}));

import { pool } from '../../src/db/index.js';

describe('Transaction Utilities', () => {
    let mockClient: any;

    beforeEach(() => {
        mockClient = {
            query: vi.fn(),
            release: vi.fn(),
        };
        vi.mocked(pool.connect).mockResolvedValue(mockClient);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('withTransaction', () => {
        it('should commit and return result on success', async () => {
            mockClient.query.mockResolvedValue({});

            const { withTransaction } = await import('../../src/db/transactions.js');

            const result = await withTransaction(async (client) => {
                await client.query('SELECT 1');
                return 42;
            });

            expect(result).toBe(42);
            expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
            expect(mockClient.query).toHaveBeenCalledWith('SELECT 1');
            expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
            expect(mockClient.release).toHaveBeenCalled();
        });

        it('should rollback and rethrow on callback error', async () => {
            mockClient.query.mockResolvedValue({});

            const { withTransaction } = await import('../../src/db/transactions.js');

            await expect(
                withTransaction(async () => {
                    throw new Error('callback failure');
                })
            ).rejects.toThrow('callback failure');

            expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
            expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
            expect(mockClient.query).not.toHaveBeenCalledWith('COMMIT');
            expect(mockClient.release).toHaveBeenCalled();
        });

        it('should release client even when rollback itself fails', async () => {
            mockClient.query
                .mockResolvedValueOnce({}) // BEGIN
                .mockRejectedValueOnce(new Error('callback failure')) // callback query
                .mockRejectedValueOnce(new Error('ROLLBACK failed')); // ROLLBACK fails

            const { withTransaction } = await import('../../src/db/transactions.js');

            // The original callback error should still propagate
            // (rollback error may be swallowed or overridden depending on implementation)
            await expect(
                withTransaction(async (client) => {
                    await client.query('BAD QUERY');
                })
            ).rejects.toThrow();

            // Client must always be released
            expect(mockClient.release).toHaveBeenCalled();
        });

        it('should pass the pool client to the callback', async () => {
            mockClient.query.mockResolvedValue({});

            const { withTransaction } = await import('../../src/db/transactions.js');

            let receivedClient: any = null;
            await withTransaction(async (client) => {
                receivedClient = client;
                return null;
            });

            // The callback should receive the same client we mocked
            expect(receivedClient).toBe(mockClient);
        });

        it('should propagate the return type from the callback', async () => {
            mockClient.query.mockResolvedValue({});

            const { withTransaction } = await import('../../src/db/transactions.js');

            const objResult = await withTransaction(async () => ({ key: 'value', count: 5 }));
            expect(objResult).toEqual({ key: 'value', count: 5 });

            const arrResult = await withTransaction(async () => [1, 2, 3]);
            expect(arrResult).toEqual([1, 2, 3]);

            const nullResult = await withTransaction(async () => null);
            expect(nullResult).toBeNull();
        });
    });

    describe('atomicBalanceUpdate', () => {
        it('should return new balance on successful update', async () => {
            mockClient.query.mockResolvedValueOnce({
                rows: [{ balance: 150 }],
            });

            const { atomicBalanceUpdate } = await import('../../src/db/transactions.js');

            const result = await atomicBalanceUpdate('guild123', 'user456', 50);

            expect(result).toEqual({ success: true, newBalance: 150 });
            expect(mockClient.query).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE guild_members'),
                [50, 'guild123', 'user456']
            );
            expect(mockClient.release).toHaveBeenCalled();
        });

        it('should return null when balance is insufficient', async () => {
            mockClient.query.mockResolvedValueOnce({
                rows: [], // No rows returned means insufficient balance
            });

            const { atomicBalanceUpdate } = await import('../../src/db/transactions.js');

            const result = await atomicBalanceUpdate('guild123', 'user456', -1000);

            expect(result).toBeNull();
            expect(mockClient.release).toHaveBeenCalled();
        });

        it('should prevent negative balance by requiring balance + amount >= 0', async () => {
            // This simulates the WHERE clause preventing the update
            mockClient.query.mockResolvedValueOnce({
                rows: [],
            });

            const { atomicBalanceUpdate } = await import('../../src/db/transactions.js');

            // Trying to subtract 100 when user only has 50
            const result = await atomicBalanceUpdate('guild123', 'user456', -100);

            expect(result).toBeNull();
        });

        it('should release client on query error', async () => {
            mockClient.query.mockRejectedValueOnce(new Error('connection lost'));

            const { atomicBalanceUpdate } = await import('../../src/db/transactions.js');

            await expect(
                atomicBalanceUpdate('guild123', 'user456', 50)
            ).rejects.toThrow('connection lost');

            expect(mockClient.release).toHaveBeenCalled();
        });

        it('should pass amount as the first SQL parameter', async () => {
            mockClient.query.mockResolvedValueOnce({
                rows: [{ balance: 200 }],
            });

            const { atomicBalanceUpdate } = await import('../../src/db/transactions.js');

            await atomicBalanceUpdate('g1', 'u1', -75);

            expect(mockClient.query).toHaveBeenCalledWith(
                expect.stringContaining('balance + $1 >= 0'),
                [-75, 'g1', 'u1']
            );
        });
    });

    describe('atomicCooldownCheck', () => {
        it('should return success with new timestamp when cooldown has passed', async () => {
            const now = new Date();
            mockClient.query.mockResolvedValueOnce({
                rows: [{ last_daily: now }],
            });

            const { atomicCooldownCheck } = await import('../../src/db/transactions.js');

            const result = await atomicCooldownCheck('guild1', 'user1', 'last_daily', 86400);

            expect(result).toEqual({ success: true, newTimestamp: now });
            expect(mockClient.query).toHaveBeenCalledWith(
                expect.stringContaining('last_daily'),
                ['guild1', 'user1']
            );
            expect(mockClient.release).toHaveBeenCalled();
        });

        it('should return success for last_work cooldown field', async () => {
            const now = new Date();
            mockClient.query.mockResolvedValueOnce({
                rows: [{ last_work: now }],
            });

            const { atomicCooldownCheck } = await import('../../src/db/transactions.js');

            const result = await atomicCooldownCheck('guild1', 'user1', 'last_work', 3600);

            expect(result).toEqual({ success: true, newTimestamp: now });
            expect(mockClient.query).toHaveBeenCalledWith(
                expect.stringContaining('last_work'),
                ['guild1', 'user1']
            );
        });

        it('should return timeLeft when still on cooldown', async () => {
            // First query: UPDATE returns no rows (cooldown not passed)
            mockClient.query
                .mockResolvedValueOnce({ rows: [] })
                // Second query: SELECT to get remaining time
                .mockResolvedValueOnce({
                    rows: [{ time_left: 3600 }],
                });

            const { atomicCooldownCheck } = await import('../../src/db/transactions.js');

            const result = await atomicCooldownCheck('guild1', 'user1', 'last_daily', 86400);

            expect(result).toEqual({ success: false, timeLeft: 3600 });
            expect(mockClient.release).toHaveBeenCalled();
        });

        it('should ceil and clamp timeLeft to at least 0', async () => {
            mockClient.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({
                    rows: [{ time_left: -5 }], // negative (clock skew or past cooldown)
                });

            const { atomicCooldownCheck } = await import('../../src/db/transactions.js');

            const result = await atomicCooldownCheck('guild1', 'user1', 'last_daily', 86400);

            expect(result).toEqual({ success: false, timeLeft: 0 });
        });

        it('should ceil fractional timeLeft', async () => {
            mockClient.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({
                    rows: [{ time_left: 120.3 }],
                });

            const { atomicCooldownCheck } = await import('../../src/db/transactions.js');

            const result = await atomicCooldownCheck('guild1', 'user1', 'last_daily', 86400);

            expect(result).toEqual({ success: false, timeLeft: 121 });
        });

        it('should default timeLeft to cooldownSeconds when row is missing', async () => {
            mockClient.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [] }); // user not found

            const { atomicCooldownCheck } = await import('../../src/db/transactions.js');

            const result = await atomicCooldownCheck('guild1', 'user1', 'last_daily', 86400);

            expect(result).toEqual({ success: false, timeLeft: 86400 });
        });

        it('should release client on error', async () => {
            mockClient.query.mockRejectedValueOnce(new Error('db error'));

            const { atomicCooldownCheck } = await import('../../src/db/transactions.js');

            await expect(
                atomicCooldownCheck('guild1', 'user1', 'last_daily', 86400)
            ).rejects.toThrow('db error');

            expect(mockClient.release).toHaveBeenCalled();
        });
    });

    describe('atomicTransfer', () => {
        it('should transfer balance between users within a transaction', async () => {
            // BEGIN
            mockClient.query
                .mockResolvedValueOnce({}) // BEGIN
                .mockResolvedValueOnce({ rows: [{ balance: 50 }] }) // Debit sender
                .mockResolvedValueOnce({ rows: [{ balance: 100 }] }) // Credit receiver
                .mockResolvedValueOnce({}); // COMMIT

            const { atomicTransfer } = await import('../../src/db/transactions.js');

            const result = await atomicTransfer('guild123', 'sender', 'receiver', 50);

            expect(result).toEqual({
                success: true,
                senderBalance: 50,
                receiverBalance: 100,
            });

            // Verify transaction was committed
            expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
            expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
        });

        it('should return error when sender has insufficient balance', async () => {
            mockClient.query
                .mockResolvedValueOnce({}) // BEGIN
                .mockResolvedValueOnce({ rows: [] }) // Debit fails - insufficient balance
                .mockResolvedValueOnce({}); // COMMIT (no changes were made)

            const { atomicTransfer } = await import('../../src/db/transactions.js');

            const result = await atomicTransfer('guild123', 'sender', 'receiver', 1000);

            expect(result).toEqual({
                success: false,
                error: 'Insufficient balance',
            });

            // Transaction commits because no modifications occurred
            // (early return before any changes)
            expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
        });

        it('should rollback on database error', async () => {
            mockClient.query
                .mockResolvedValueOnce({}) // BEGIN
                .mockRejectedValueOnce(new Error('Database error')); // Debit fails with error

            const { atomicTransfer } = await import('../../src/db/transactions.js');

            await expect(atomicTransfer('guild123', 'sender', 'receiver', 50))
                .rejects.toThrow('Database error');

            expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
        });

        it('should release client after successful transfer', async () => {
            mockClient.query
                .mockResolvedValueOnce({}) // BEGIN
                .mockResolvedValueOnce({ rows: [{ balance: 0 }] }) // Debit sender
                .mockResolvedValueOnce({ rows: [{ balance: 100 }] }) // Credit receiver
                .mockResolvedValueOnce({}); // COMMIT

            const { atomicTransfer } = await import('../../src/db/transactions.js');

            await atomicTransfer('guild123', 'sender', 'receiver', 100);

            expect(mockClient.release).toHaveBeenCalled();
        });

        it('should release client after rollback on error', async () => {
            mockClient.query
                .mockResolvedValueOnce({}) // BEGIN
                .mockRejectedValueOnce(new Error('fail')); // query error

            const { atomicTransfer } = await import('../../src/db/transactions.js');

            await expect(atomicTransfer('guild123', 'sender', 'receiver', 50))
                .rejects.toThrow('fail');

            expect(mockClient.release).toHaveBeenCalled();
        });

        it('should use upsert for crediting the receiver', async () => {
            mockClient.query
                .mockResolvedValueOnce({}) // BEGIN
                .mockResolvedValueOnce({ rows: [{ balance: 0 }] }) // Debit sender
                .mockResolvedValueOnce({ rows: [{ balance: 50 }] }) // Credit receiver via upsert
                .mockResolvedValueOnce({}); // COMMIT

            const { atomicTransfer } = await import('../../src/db/transactions.js');

            await atomicTransfer('guild123', 'sender', 'newUser', 50);

            // The credit query should use INSERT ... ON CONFLICT for upsert
            const creditCall = mockClient.query.mock.calls[2];
            expect(creditCall[0]).toContain('INSERT INTO guild_members');
            expect(creditCall[0]).toContain('ON CONFLICT');
        });
    });

    describe('Race Condition Prevention', () => {
        it('should prevent double-spend via concurrent balance checks', async () => {
            // Simulate two concurrent requests trying to spend the same balance
            // The atomicity ensures only one succeeds

            let balance = 100;

            // First request succeeds
            mockClient.query.mockImplementationOnce(async () => {
                if (balance >= 100) {
                    balance -= 100;
                    return { rows: [{ balance }] };
                }
                return { rows: [] };
            });

            // Second request fails because balance is now 0
            mockClient.query.mockImplementationOnce(async () => {
                if (balance >= 100) {
                    balance -= 100;
                    return { rows: [{ balance }] };
                }
                return { rows: [] };
            });

            const { atomicBalanceUpdate } = await import('../../src/db/transactions.js');

            // Simulate concurrent requests
            const results = await Promise.all([
                atomicBalanceUpdate('guild123', 'user456', -100),
                atomicBalanceUpdate('guild123', 'user456', -100),
            ]);

            // Only one should succeed
            const successCount = results.filter(r => r !== null).length;
            expect(successCount).toBe(1);
        });

        it('should prevent coinflip exploit via rapid betting', async () => {
            // User has 100 coins, tries to bet 100 twice rapidly
            const initialBalance = 100;
            let currentBalance = initialBalance;

            mockClient.query.mockImplementation(async (query: string, params: unknown[]) => {
                if (query.includes('UPDATE')) {
                    const amount = params[0] as number;
                    // Simulate atomic check: only succeeds if balance >= bet amount
                    if (currentBalance >= Math.abs(amount)) {
                        currentBalance += amount;
                        return { rows: [{ balance: currentBalance }] };
                    }
                    return { rows: [] }; // Insufficient balance
                }
                return { rows: [] };
            });

            const { atomicBalanceUpdate } = await import('../../src/db/transactions.js');

            // Try to bet 100 coins twice (user wins both, but should only be able to bet once)
            const bet1 = await atomicBalanceUpdate('guild123', 'user456', -100);
            const bet2 = await atomicBalanceUpdate('guild123', 'user456', -100);

            // First bet should succeed
            expect(bet1).not.toBeNull();

            // Second bet should fail (insufficient balance after first bet)
            expect(bet2).toBeNull();
        });
    });
});
