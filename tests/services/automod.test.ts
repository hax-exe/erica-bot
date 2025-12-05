import { describe, it, expect } from 'vitest';

// Testing auto-mod detection functions in isolation

describe('Auto-Mod Detection', () => {
    describe('Banned Words Check', () => {
        function checkBannedWords(content: string, bannedWords: string[]): boolean {
            if (bannedWords.length === 0) return false;
            const lowerContent = content.toLowerCase();
            return bannedWords.some(word => lowerContent.includes(word.toLowerCase()));
        }

        it('should detect banned word', () => {
            expect(checkBannedWords('this is spam', ['spam'])).toBe(true);
        });

        it('should be case insensitive', () => {
            expect(checkBannedWords('This is SPAM', ['spam'])).toBe(true);
        });

        it('should return false when no banned words', () => {
            expect(checkBannedWords('this is fine', ['spam', 'bad'])).toBe(false);
        });

        it('should handle empty banned words list', () => {
            expect(checkBannedWords('anything', [])).toBe(false);
        });
    });

    describe('Excessive Caps Check', () => {
        function checkExcessiveCaps(content: string): boolean {
            if (content.length < 10) return false;
            const letters = content.replace(/[^a-zA-Z]/g, '');
            if (letters.length < 10) return false;
            const caps = letters.replace(/[^A-Z]/g, '');
            return (caps.length / letters.length) > 0.7;
        }

        it('should detect excessive caps', () => {
            expect(checkExcessiveCaps('THIS IS ALL CAPS MESSAGE')).toBe(true);
        });

        it('should not flag normal text', () => {
            expect(checkExcessiveCaps('This is a normal sentence.')).toBe(false);
        });

        it('should not flag short messages', () => {
            expect(checkExcessiveCaps('HI THERE')).toBe(false);
        });

        it('should handle messages with few letters', () => {
            expect(checkExcessiveCaps('12345 67890 !!!')).toBe(false);
        });
    });

    describe('Mass Mentions Check', () => {
        function checkMassMentions(userMentions: number, roleMentions: number, mentionsEveryone: boolean): boolean {
            const totalMentions = userMentions + roleMentions;
            return totalMentions > 5 || mentionsEveryone;
        }

        it('should flag more than 5 mentions', () => {
            expect(checkMassMentions(4, 2, false)).toBe(true);
        });

        it('should flag @everyone', () => {
            expect(checkMassMentions(0, 0, true)).toBe(true);
        });

        it('should not flag normal mentions', () => {
            expect(checkMassMentions(2, 1, false)).toBe(false);
        });

        it('should not flag exactly 5 mentions', () => {
            expect(checkMassMentions(3, 2, false)).toBe(false);
        });
    });

    describe('Discord Invite Check', () => {
        const DISCORD_INVITE_REGEX = /(discord\.(gg|io|me|li)|discordapp\.com\/invite)\/[a-zA-Z0-9]+/gi;

        function checkInvites(content: string): string[] {
            return content.match(DISCORD_INVITE_REGEX) || [];
        }

        it('should detect discord.gg invites', () => {
            expect(checkInvites('Join my server: discord.gg/abc123')).toHaveLength(1);
        });

        it('should detect discordapp.com invites', () => {
            expect(checkInvites('https://discordapp.com/invite/xyz789')).toHaveLength(1);
        });

        it('should detect multiple invites', () => {
            expect(checkInvites('discord.gg/a1b2c3 and discord.gg/d4e5f6')).toHaveLength(2);
        });

        it('should return empty for no invites', () => {
            expect(checkInvites('This is a normal message')).toHaveLength(0);
        });

        it('should detect discord.io and discord.me', () => {
            expect(checkInvites('Join discord.io/server or discord.me/other')).toHaveLength(2);
        });
    });

    describe('Emoji Count Check', () => {
        function countEmojis(content: string): number {
            const emojiRegex = /(\p{Emoji_Presentation}|\p{Extended_Pictographic}|<a?:\w+:\d+>)/gu;
            return (content.match(emojiRegex) || []).length;
        }

        it('should count unicode emojis', () => {
            expect(countEmojis('Hello 😀 World 🎉')).toBe(2);
        });

        it('should count Discord custom emojis', () => {
            expect(countEmojis('Check <:custom:123456>')).toBe(1);
        });

        it('should count animated Discord emojis', () => {
            expect(countEmojis('Check <a:animated:789012>')).toBe(1);
        });

        it('should return 0 for no emojis', () => {
            expect(countEmojis('Plain text message')).toBe(0);
        });
    });
});
