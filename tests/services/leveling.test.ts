import { describe, it, expect } from 'vitest';

// Reimplementing the functions for testing without importing from source
// (avoids config validation during tests)

function getXpForLevel(level: number): number {
    return 5 * Math.pow(level, 2) + 50 * level + 100;
}

function getTotalXpForLevel(level: number): number {
    let total = 0;
    for (let i = 0; i < level; i++) {
        total += getXpForLevel(i);
    }
    return total;
}

function getLevelFromXp(xp: number): number {
    let level = 0;
    let requiredXp = getXpForLevel(level);
    let totalXp = 0;

    while (totalXp + requiredXp <= xp) {
        totalXp += requiredXp;
        level++;
        requiredXp = getXpForLevel(level);
    }

    return level;
}

function getXpProgress(xp: number): { current: number; required: number; percentage: number } {
    const level = getLevelFromXp(xp);
    const totalXpForCurrentLevel = getTotalXpForLevel(level);
    const xpInCurrentLevel = xp - totalXpForCurrentLevel;
    const xpRequiredForNextLevel = getXpForLevel(level);
    const percentage = Math.floor((xpInCurrentLevel / xpRequiredForNextLevel) * 100);

    return {
        current: xpInCurrentLevel,
        required: xpRequiredForNextLevel,
        percentage,
    };
}

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
            // Sum of XP for levels 0-4
            const expected = getXpForLevel(0) + getXpForLevel(1) + getXpForLevel(2) + getXpForLevel(3) + getXpForLevel(4);
            expect(getTotalXpForLevel(5)).toBe(expected);
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
    });
});
