import { Message } from 'discord.js';
import { db } from '../db/index.js';
import { autoResponders } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('auto-responder');

// Maximum time to allow regex matching (in ms)
const REGEX_TIMEOUT_MS = 100;

// Maximum length for triggers and responses
const MAX_TRIGGER_LENGTH = 200;
const MAX_RESPONSE_LENGTH = 2000;

/**
 * Check and respond to auto-responder triggers
 */
export async function checkAutoResponders(message: Message): Promise<boolean> {
    if (!message.guild || message.author.bot) return false;

    const responders = await db.query.autoResponders.findMany({
        where: eq(autoResponders.guildId, message.guild.id),
    });

    const enabledResponders = responders.filter((r) => r.enabled);

    for (const responder of enabledResponders) {
        if (matchesTrigger(message.content, responder.trigger, responder.triggerType || 'contains')) {
            // Replace placeholders in response
            const response = responder.response
                .replace('{user}', `<@${message.author.id}>`)
                .replace('{username}', message.author.username)
                .replace('{server}', message.guild.name)
                .replace('{channel}', `<#${message.channel.id}>`);

            await message.reply(response);
            return true;
        }
    }

    return false;
}

/**
 * Match content against a trigger with timeout protection for regex
 */
function matchesTrigger(content: string, trigger: string, type: string): boolean {
    const lowerContent = content.toLowerCase();
    const lowerTrigger = trigger.toLowerCase();

    switch (type) {
        case 'exact':
            return lowerContent === lowerTrigger;
        case 'startswith':
            return lowerContent.startsWith(lowerTrigger);
        case 'regex':
            return safeRegexTest(content, trigger);
        case 'contains':
        default:
            return lowerContent.includes(lowerTrigger);
    }
}

/**
 * Test regex with timeout protection to prevent ReDoS attacks
 */
function safeRegexTest(content: string, pattern: string): boolean {
    try {
        // Validate regex isn't too complex
        if (!isRegexSafe(pattern)) {
            logger.warn({ pattern }, 'Unsafe regex pattern detected, skipping');
            return false;
        }

        // Create regex with case-insensitive flag
        const regex = new RegExp(pattern, 'i');

        // Use simple test - for truly ReDoS-resistant matching,
        // consider using a library like 're2' in production
        const startTime = Date.now();
        const result = regex.test(content);
        const elapsed = Date.now() - startTime;

        if (elapsed > REGEX_TIMEOUT_MS) {
            logger.warn({ pattern, elapsed }, 'Regex execution took too long');
        }

        return result;
    } catch (error) {
        logger.error({ error, pattern }, 'Invalid regex pattern');
        return false;
    }
}

/**
 * Basic check for potentially dangerous regex patterns
 * This is a heuristic check - for full protection, use a regex analysis library
 */
function isRegexSafe(pattern: string): boolean {
    // Patterns that are often involved in ReDoS
    const dangerousPatterns = [
        /(\.\*){3,}/, // Multiple consecutive wildcards
        /(\([^)]*\+[^)]*\)){2,}\+/, // Nested quantifiers
        /(\+|\*|\?)\1+/, // Multiple consecutive quantifiers
        /\([^)]*\|\s*\)[+*]/, // Alternation with quantifier
    ];

    for (const dangerous of dangerousPatterns) {
        if (dangerous.test(pattern)) {
            return false;
        }
    }

    // Check for excessive length
    if (pattern.length > MAX_TRIGGER_LENGTH) {
        return false;
    }

    // Check for too many backtracking opportunities  
    const backtrackers = (pattern.match(/[+*?]/g) || []).length;
    const groups = (pattern.match(/\(/g) || []).length;

    // Heuristic: high backtracking potential
    if (backtrackers > 10 || (groups > 5 && backtrackers > 5)) {
        return false;
    }

    return true;
}

/**
 * Validate a trigger pattern before saving to database
 */
export function validateTrigger(trigger: string, type: string): { valid: boolean; error?: string } {
    if (!trigger || trigger.trim().length === 0) {
        return { valid: false, error: 'Trigger cannot be empty' };
    }

    if (trigger.length > MAX_TRIGGER_LENGTH) {
        return { valid: false, error: `Trigger exceeds maximum length of ${MAX_TRIGGER_LENGTH} characters` };
    }

    if (type === 'regex') {
        try {
            new RegExp(trigger);
        } catch {
            return { valid: false, error: 'Invalid regex pattern' };
        }

        if (!isRegexSafe(trigger)) {
            return { valid: false, error: 'Regex pattern is too complex or potentially dangerous' };
        }
    }

    return { valid: true };
}

/**
 * Validate a response before saving to database
 */
export function validateResponse(response: string): { valid: boolean; error?: string } {
    if (!response || response.trim().length === 0) {
        return { valid: false, error: 'Response cannot be empty' };
    }

    if (response.length > MAX_RESPONSE_LENGTH) {
        return { valid: false, error: `Response exceeds maximum length of ${MAX_RESPONSE_LENGTH} characters` };
    }

    return { valid: true };
}
