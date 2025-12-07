import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the database module
vi.mock('../../src/db/index.js', () => ({
    pool: {
        connect: vi.fn(),
    },
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

    describe('atomicBalanceUpdate', () => {
        it('should return new balance on successful update', async () => {
            mockClient.query.mockResolvedValueOnce({
                rows: [{ balance: 150 }],
            });

            // Import after mocking
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
