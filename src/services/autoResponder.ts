import { Message } from 'discord.js';
import { db } from '../db/index.js';
import { autoResponders } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';

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

function matchesTrigger(content: string, trigger: string, type: string): boolean {
    const lowerContent = content.toLowerCase();
    const lowerTrigger = trigger.toLowerCase();

    switch (type) {
        case 'exact':
            return lowerContent === lowerTrigger;
        case 'startswith':
            return lowerContent.startsWith(lowerTrigger);
        case 'regex':
            try {
                const regex = new RegExp(trigger, 'i');
                return regex.test(content);
            } catch {
                return false;
            }
        case 'contains':
        default:
            return lowerContent.includes(lowerTrigger);
    }
}
