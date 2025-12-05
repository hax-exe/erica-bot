import { describe, it, expect } from 'vitest';

// Test utility functions that would be shared across commands

describe('Duration Parser', () => {
    // Reimplementing parseDuration for testing
    function parseDuration(duration: string): number | undefined {
        const match = duration.match(/^(\d+)(s|m|h|d|w)$/i);
        if (!match) return undefined;

        const value = parseInt(match[1]!, 10);
        const unit = match[2]!.toLowerCase();

        const multipliers: Record<string, number> = {
            s: 1000,
            m: 60 * 1000,
            h: 60 * 60 * 1000,
            d: 24 * 60 * 60 * 1000,
            w: 7 * 24 * 60 * 60 * 1000,
        };

        return value * (multipliers[unit] || 0);
    }

    it('should parse seconds correctly', () => {
        expect(parseDuration('30s')).toBe(30000);
    });

    it('should parse minutes correctly', () => {
        expect(parseDuration('5m')).toBe(300000);
    });

    it('should parse hours correctly', () => {
        expect(parseDuration('2h')).toBe(7200000);
    });

    it('should parse days correctly', () => {
        expect(parseDuration('1d')).toBe(86400000);
    });

    it('should parse weeks correctly', () => {
        expect(parseDuration('1w')).toBe(604800000);
    });

    it('should be case insensitive', () => {
        expect(parseDuration('1H')).toBe(parseDuration('1h'));
        expect(parseDuration('2D')).toBe(parseDuration('2d'));
    });

    it('should return undefined for invalid format', () => {
        expect(parseDuration('invalid')).toBeUndefined();
        expect(parseDuration('5')).toBeUndefined();
        expect(parseDuration('m5')).toBeUndefined();
        expect(parseDuration('5x')).toBeUndefined();
    });
});

describe('Time Formatter', () => {
    function formatDuration(ms: number): string {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) {
            return `${hours}:${(minutes % 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
        }
        return `${minutes}:${(seconds % 60).toString().padStart(2, '0')}`;
    }

    it('should format seconds only', () => {
        expect(formatDuration(45000)).toBe('0:45');
    });

    it('should format minutes and seconds', () => {
        expect(formatDuration(90000)).toBe('1:30');
    });

    it('should format hours, minutes, and seconds', () => {
        expect(formatDuration(3665000)).toBe('1:01:05');
    });

    it('should pad correctly', () => {
        expect(formatDuration(61000)).toBe('1:01');
        expect(formatDuration(3605000)).toBe('1:00:05');
    });
});

describe('Progress Bar Generator', () => {
    function createProgressBar(percentage: number, length = 20): string {
        const filled = Math.round((percentage / 100) * length);
        const empty = length - filled;
        return '█'.repeat(filled) + '░'.repeat(empty);
    }

    it('should create empty bar for 0%', () => {
        const bar = createProgressBar(0, 10);
        expect(bar).toBe('░░░░░░░░░░');
    });

    it('should create full bar for 100%', () => {
        const bar = createProgressBar(100, 10);
        expect(bar).toBe('██████████');
    });

    it('should create half bar for 50%', () => {
        const bar = createProgressBar(50, 10);
        expect(bar).toBe('█████░░░░░');
    });

    it('should handle custom lengths', () => {
        const bar = createProgressBar(50, 20);
        expect(bar.length).toBe(20);
    });
});
