import type { Message } from 'discord.js';
import type { AutoresponderMatchMode } from '../db/schema.js';

export interface AutoresponderRule {
	id: number;
	guildId: string;
	name: string;
	trigger: string;
	matchMode: AutoresponderMatchMode;
	response: string;
	enabled: boolean;
	cooldownSeconds: number;
	channelIds: string;
	replyToMessage: boolean;
}

const MATCH_LABELS: Record<AutoresponderMatchMode, string> = {
	exact: 'Exact match',
	contains: 'Contains',
	starts_with: 'Starts with',
	ends_with: 'Ends with',
	regex: 'Regex',
};

export function matchModeLabel(mode: AutoresponderMatchMode): string {
	return MATCH_LABELS[mode] ?? mode;
}

export function parseChannelIds(raw: string): string[] {
	try {
		const parsed = JSON.parse(raw) as unknown;
		return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
	} catch {
		return [];
	}
}

/** Safe match — regex failures / ReDoS-ish patterns simply do not match. */
export function messageMatchesTrigger(content: string, trigger: string, mode: AutoresponderMatchMode): boolean {
	const text = content.trim();
	if (!text || !trigger) return false;

	switch (mode) {
		case 'exact':
			return text.toLowerCase() === trigger.toLowerCase();
		case 'contains':
			return text.toLowerCase().includes(trigger.toLowerCase());
		case 'starts_with':
			return text.toLowerCase().startsWith(trigger.toLowerCase());
		case 'ends_with':
			return text.toLowerCase().endsWith(trigger.toLowerCase());
		case 'regex': {
			if (trigger.length > 120) return false;
			try {
				return new RegExp(trigger, 'i').test(text);
			} catch {
				return false;
			}
		}
		default:
			return false;
	}
}

export function formatAutoresponderResponse(template: string, message: Message): string {
	const guildName = message.guild?.name ?? 'server';
	return template
		.replaceAll('{user}', message.author.username)
		.replaceAll('{mention}', `<@${message.author.id}>`)
		.replaceAll('{server}', guildName)
		.replaceAll('{channel}', `<#${message.channelId}>`)
		.slice(0, 2000);
}

export function validateRegexTrigger(pattern: string): string | null {
	if (pattern.length > 120) return 'Regex triggers must be 120 characters or fewer.';
	try {
		new RegExp(pattern, 'i');
		return null;
	} catch {
		return 'Invalid regular expression.';
	}
}
