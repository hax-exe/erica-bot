import { describe, it, expect, vi } from 'vitest';

// Mock dependencies that trigger config/db initialization at import time
vi.mock('../../src/db/index.js', () => ({
    db: {
        query: { guildMembers: { findFirst: vi.fn() } },
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn() }) }),
        update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn() }) }),
    },
}));

vi.mock('../../src/services/settingsCache.js', () => ({
    getLevelingSettings: vi.fn().mockResolvedValue(null),
    getDefaultLevelingSettings: () => ({
        xpPerMessage: 15,
        xpCooldown: 60,
        xpMultiplier: 100,
        announceEnabled: true,
        announceMessage: '🎉 Congratulations {user}! You reached level {level}!',
        ignoredChannels: [] as string[],
        ignoredRoles: [] as string[],
    }),
}));

// Import real source functions after mocks are set up
const {
    getXpForLevel,
    getTotalXpForLevel,
    getLevelFromXp,
    getXpProgress,
} = await import('../../src/services/leveling.js');

describe('Leveling Service', () => {
    describe('getXpForLevel', () => {
        it('should return correct XP for level 0', () => {
            expect(getXpForLevel(0)).toBe(100);
        });

        it('should return correct XP for level 1', () => {
            // 5 * 1 + 50 * 1 + 100 = 155
            expect(getXpForLevel(1)).toBe(155);
        });

        it('should return correct XP for level 5', () => {
            // 5 * 25 + 50 * 5 + 100 = 125 + 250 + 100 = 475
            expect(getXpForLevel(5)).toBe(475);
        });

        it('should return correct XP for level 10', () => {
            // 5 * 100 + 50 * 10 + 100 = 500 + 500 + 100 = 1100
            expect(getXpForLevel(10)).toBe(1100);
        });

        it('should increase monotonically', () => {
            for (let i = 0; i < 50; i++) {
                expect(getXpForLevel(i + 1)).toBeGreaterThan(getXpForLevel(i));
            }
        });
    });

    describe('getTotalXpForLevel', () => {
        it('should return 0 for level 0', () => {
            expect(getTotalXpForLevel(0)).toBe(0);
        });

        it('should return 100 for level 1', () => {
            expect(getTotalXpForLevel(1)).toBe(100);
        });

        it('should return cumulative XP for level 2', () => {
            // Level 0 XP (100) + Level 1 XP (155) = 255
            expect(getTotalXpForLevel(2)).toBe(255);
        });

        it('should return cumulative XP for level 5', () => {
            const expected = getXpForLevel(0) + getXpForLevel(1) + getXpForLevel(2) + getXpForLevel(3) + getXpForLevel(4);
            expect(getTotalXpForLevel(5)).toBe(expected);
        });

        it('should increase monotonically', () => {
            for (let i = 0; i < 50; i++) {
                expect(getTotalXpForLevel(i + 1)).toBeGreaterThan(getTotalXpForLevel(i));
            }
        });
    });

    describe('getLevelFromXp', () => {
        it('should return 0 for 0 XP', () => {
            expect(getLevelFromXp(0)).toBe(0);
        });

        it('should return 0 for 99 XP (just below level 1)', () => {
            expect(getLevelFromXp(99)).toBe(0);
        });

        it('should return 1 for 100 XP (exactly level 1)', () => {
            expect(getLevelFromXp(100)).toBe(1);
        });

        it('should return 1 for 254 XP (just below level 2)', () => {
            expect(getLevelFromXp(254)).toBe(1);
        });

        it('should return 2 for 255 XP (exactly level 2)', () => {
            expect(getLevelFromXp(255)).toBe(2);
        });

        it('should handle large XP values', () => {
            const xp = 10000;
            const level = getLevelFromXp(xp);
            expect(level).toBeGreaterThan(0);
            expect(getTotalXpForLevel(level)).toBeLessThanOrEqual(xp);
            expect(getTotalXpForLevel(level + 1)).toBeGreaterThan(xp);
        });

        it('should be the inverse of getTotalXpForLevel at exact boundaries', () => {
            for (let level = 0; level < 20; level++) {
                const totalXp = getTotalXpForLevel(level);
                expect(getLevelFromXp(totalXp)).toBe(level);
            }
        });
    });

    describe('getXpProgress', () => {
        it('should return correct progress for 0 XP', () => {
            const progress = getXpProgress(0);
            expect(progress.current).toBe(0);
            expect(progress.required).toBe(100);
            expect(progress.percentage).toBe(0);
        });

        it('should return correct progress for 50 XP (50% of level 0)', () => {
            const progress = getXpProgress(50);
            expect(progress.current).toBe(50);
            expect(progress.required).toBe(100);
            expect(progress.percentage).toBe(50);
        });

        it('should return correct progress for 150 XP (in level 1)', () => {
            const progress = getXpProgress(150);
            // At level 1, total XP needed was 100, so 150 - 100 = 50 into level 1
            expect(progress.current).toBe(50);
            expect(progress.required).toBe(155); // XP needed for level 1
        });

        it('should return 0 current at exact level boundaries', () => {
            for (let level = 0; level < 10; level++) {
                const totalXp = getTotalXpForLevel(level);
                const progress = getXpProgress(totalXp);
                expect(progress.current).toBe(0);
                expect(progress.required).toBe(getXpForLevel(level));
            }
        });

        it('should keep percentage between 0 and 99', () => {
            for (let xp = 0; xp < 5000; xp += 37) {
                const progress = getXpProgress(xp);
                expect(progress.percentage).toBeGreaterThanOrEqual(0);
                expect(progress.percentage).toBeLessThan(100);
            }
        });
    });
});
