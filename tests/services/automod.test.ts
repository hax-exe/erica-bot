import { describe, it, expect } from 'vitest';
import {
    checkBannedWords,
    checkExcessiveCaps,
    checkExcessiveEmojis,
    checkMassMentions,
    checkInvites,
    DISCORD_INVITE_REGEX,
} from '../../src/services/automod.js';
import type { AutoModResult } from '../../src/services/automod.js';
import type { Message } from 'discord.js';
import { Collection } from 'discord.js';

/**
 * Create a minimal mock Message with mentions for checkMassMentions tests.
 */
function mockMessageWithMentions(
    userCount: number,
    roleCount: number,
    everyone: boolean,
): Message {
    const users = new Collection<string, unknown>();
    for (let i = 0; i < userCount; i++) {
        users.set(`user${i}`, { id: `user${i}` });
    }

    const roles = new Collection<string, unknown>();
    for (let i = 0; i < roleCount; i++) {
        roles.set(`role${i}`, { id: `role${i}` });
    }

    return {
        mentions: {
            users,
            roles,
            everyone,
        },
    } as unknown as Message;
}

/**
 * Create a minimal mock Message with content for checkInvites tests.
 */
function mockMessageWithContent(content: string): Message {
    return { content } as unknown as Message;
}

describe('Auto-Mod Detection', () => {
    describe('checkBannedWords', () => {
        it('should detect banned word', () => {
            const result = checkBannedWords('this is spam', ['spam']);
            expect(result.shouldDelete).toBe(true);
            expect(result.reason).toBe('Banned word detected');
            expect(result.action).toBe('warn');
        });

        it('should be case insensitive', () => {
            const result = checkBannedWords('This is SPAM', ['spam']);
            expect(result.shouldDelete).toBe(true);
        });

        it('should return false when content has no banned words', () => {
            const result = checkBannedWords('this is fine', ['spam', 'bad']);
            expect(result.shouldDelete).toBe(false);
        });

        it('should handle empty banned words list', () => {
            const result = checkBannedWords('anything', []);
            expect(result.shouldDelete).toBe(false);
        });

        it('should detect partial matches (substring)', () => {
            const result = checkBannedWords('unspammy', ['spam']);
            expect(result.shouldDelete).toBe(true);
        });

        it('should check all banned words', () => {
            const result = checkBannedWords('this is bad content', ['spam', 'bad', 'evil']);
            expect(result.shouldDelete).toBe(true);
            expect(result.reason).toBe('Banned word detected');
        });

        it('should handle empty content', () => {
            const result = checkBannedWords('', ['spam']);
            expect(result.shouldDelete).toBe(false);
        });
    });

    describe('checkExcessiveCaps', () => {
        it('should detect excessive caps', () => {
            const result = checkExcessiveCaps('THIS IS ALL CAPS MESSAGE');
            expect(result.shouldDelete).toBe(true);
            expect(result.reason).toBe('Excessive use of capital letters');
        });

        it('should not flag normal text', () => {
            const result = checkExcessiveCaps('This is a normal sentence.');
            expect(result.shouldDelete).toBe(false);
        });

        it('should not flag short messages (less than 10 chars)', () => {
            const result = checkExcessiveCaps('HI THERE');
            expect(result.shouldDelete).toBe(false);
        });

        it('should not flag messages with fewer than 10 letters', () => {
            const result = checkExcessiveCaps('12345 67890 !!!');
            expect(result.shouldDelete).toBe(false);
        });

        it('should allow exactly 70% caps ratio (not exceeding threshold)', () => {
            // 7 caps out of 10 letters = exactly 0.7 — threshold is > 0.7
            const result = checkExcessiveCaps('ABCDEFGabc');
            expect(result.shouldDelete).toBe(false);
        });

        it('should flag when caps ratio exceeds 70%', () => {
            // 8 caps out of 10 letters = 0.8 > 0.7
            const result = checkExcessiveCaps('ABCDEFGHab');
            expect(result.shouldDelete).toBe(true);
        });

        it('should ignore non-letter characters when calculating ratio', () => {
            // Numbers and symbols don't count toward letter/caps counts
            const result = checkExcessiveCaps('abc123def456ghijklmno');
            expect(result.shouldDelete).toBe(false);
        });
    });

    describe('checkExcessiveEmojis', () => {
        it('should flag more than 10 emojis', () => {
            const content = '😀😀😀😀😀😀😀😀😀😀😀';
            const result = checkExcessiveEmojis(content);
            expect(result.shouldDelete).toBe(true);
            expect(result.reason).toBe('Excessive emojis');
        });

        it('should not flag 10 or fewer emojis', () => {
            const content = '😀😀😀😀😀😀😀😀😀😀';
            const result = checkExcessiveEmojis(content);
            expect(result.shouldDelete).toBe(false);
        });

        it('should count Discord custom emojis', () => {
            const customs = Array.from({ length: 11 }, (_, i) => `<:emoji${i}:${100000 + i}>`).join('');
            const result = checkExcessiveEmojis(customs);
            expect(result.shouldDelete).toBe(true);
        });

        it('should count animated Discord emojis', () => {
            const animated = Array.from({ length: 11 }, (_, i) => `<a:anim${i}:${200000 + i}>`).join('');
            const result = checkExcessiveEmojis(animated);
            expect(result.shouldDelete).toBe(true);
        });

        it('should return not-delete for no emojis', () => {
            const result = checkExcessiveEmojis('Plain text message');
            expect(result.shouldDelete).toBe(false);
        });

        it('should count mixed unicode and custom emojis together', () => {
            // 6 unicode + 6 custom = 12 > 10
            const content = '😀😀😀😀😀😀<:a:1><:b:2><:c:3><:d:4><:e:5><:f:6>';
            const result = checkExcessiveEmojis(content);
            expect(result.shouldDelete).toBe(true);
        });
    });

    describe('checkMassMentions', () => {
        it('should flag more than 5 total mentions', () => {
            const msg = mockMessageWithMentions(4, 2, false);
            const result = checkMassMentions(msg);
            expect(result.shouldDelete).toBe(true);
            expect(result.reason).toBe('Mass mentioning users/roles');
            expect(result.action).toBe('warn');
        });

        it('should flag @everyone', () => {
            const msg = mockMessageWithMentions(0, 0, true);
            const result = checkMassMentions(msg);
            expect(result.shouldDelete).toBe(true);
            expect(result.reason).toBe('Attempting to mention everyone');
            expect(result.action).toBe('warn');
        });

        it('should not flag normal mentions (5 or fewer)', () => {
            const msg = mockMessageWithMentions(2, 1, false);
            const result = checkMassMentions(msg);
            expect(result.shouldDelete).toBe(false);
        });

        it('should not flag exactly 5 mentions', () => {
            const msg = mockMessageWithMentions(3, 2, false);
            const result = checkMassMentions(msg);
            expect(result.shouldDelete).toBe(false);
        });

        it('should flag 6 user mentions with no role mentions', () => {
            const msg = mockMessageWithMentions(6, 0, false);
            const result = checkMassMentions(msg);
            expect(result.shouldDelete).toBe(true);
        });

        it('should flag 6 role mentions with no user mentions', () => {
            const msg = mockMessageWithMentions(0, 6, false);
            const result = checkMassMentions(msg);
            expect(result.shouldDelete).toBe(true);
        });

        it('should prioritize mass mention check over @everyone', () => {
            // Both conditions true — mass mentions check runs first
            const msg = mockMessageWithMentions(6, 0, true);
            const result = checkMassMentions(msg);
            expect(result.shouldDelete).toBe(true);
            expect(result.reason).toBe('Mass mentioning users/roles');
        });
    });

    describe('checkInvites', () => {
        it('should detect discord.gg invites', async () => {
            const msg = mockMessageWithContent('Join my server: discord.gg/abc123');
            const result = await checkInvites(msg, []);
            expect(result.shouldDelete).toBe(true);
            expect(result.reason).toBe('Discord invite link not allowed');
        });

        it('should detect discordapp.com invites', async () => {
            const msg = mockMessageWithContent('https://discordapp.com/invite/xyz789');
            const result = await checkInvites(msg, []);
            expect(result.shouldDelete).toBe(true);
        });

        it('should detect discord.io and discord.me invites', async () => {
            const msg = mockMessageWithContent('Join discord.io/server');
            const result = await checkInvites(msg, []);
            expect(result.shouldDelete).toBe(true);
        });

        it('should not flag messages without invites', async () => {
            const msg = mockMessageWithContent('This is a normal message');
            const result = await checkInvites(msg, []);
            expect(result.shouldDelete).toBe(false);
        });

        it('should allow invites in the allowed list', async () => {
            const msg = mockMessageWithContent('Join discord.gg/allowed123');
            const result = await checkInvites(msg, ['allowed123']);
            expect(result.shouldDelete).toBe(false);
        });

        it('should flag invites not in the allowed list', async () => {
            const msg = mockMessageWithContent('Join discord.gg/notallowed');
            const result = await checkInvites(msg, ['allowed123']);
            expect(result.shouldDelete).toBe(true);
        });

        it('should flag if any invite is not allowed (multiple invites)', async () => {
            const msg = mockMessageWithContent('discord.gg/allowed123 and discord.gg/sneaky');
            const result = await checkInvites(msg, ['allowed123']);
            expect(result.shouldDelete).toBe(true);
        });
    });

    describe('DISCORD_INVITE_REGEX', () => {
        it('should match discord.gg links', () => {
            const matches = 'discord.gg/abc123'.match(DISCORD_INVITE_REGEX);
            expect(matches).toHaveLength(1);
        });

        it('should match discordapp.com/invite links', () => {
            const matches = 'https://discordapp.com/invite/xyz789'.match(DISCORD_INVITE_REGEX);
            expect(matches).toHaveLength(1);
        });

        it('should match multiple invites', () => {
            const matches = 'discord.gg/a1b2c3 and discord.gg/d4e5f6'.match(DISCORD_INVITE_REGEX);
            expect(matches).toHaveLength(2);
        });

        it('should return null for no invites', () => {
            const matches = 'This is a normal message'.match(DISCORD_INVITE_REGEX);
            expect(matches).toBeNull();
        });

        it('should match discord.io and discord.me', () => {
            const matches = 'Join discord.io/server or discord.me/other'.match(DISCORD_INVITE_REGEX);
            expect(matches).toHaveLength(2);
        });
    });
});
