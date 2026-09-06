import { container } from '@sapphire/framework';

const DiscordInviteLinkRegex =
	/(?:https?:\/\/)?(?:www\.)?discord(?:\.gg|(?:app)?\.com\/invite)\/(?<code>[\w-]{2,255})/gi;

import { type GuildMember, type Message, PermissionFlagsBits, TextDisplayBuilder } from 'discord.js';
import { eq } from 'drizzle-orm';
import { Colors, CV2_FLAG, logContainer, makeContainer } from './components.js';
import { db, schema } from './database.js';
import { logFields, sendModLog } from './LoggingUtil.js';
import { createInfraction, getModActionRow } from './ModerationUtil.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AutomodAction = 'delete' | 'delete_warn' | 'delete_timeout';

export type AutomodRule = 'word-filter' | 'spam' | 'caps' | 'links' | 'invites' | 'mentions' | 'new-account';

export const AUTOMOD_RULES: AutomodRule[] = [
	'word-filter',
	'spam',
	'caps',
	'links',
	'invites',
	'mentions',
	'new-account',
];

export const AUTOMOD_RULE_LABELS: Record<AutomodRule, string> = {
	'word-filter': 'Word Filter',
	spam: 'Spam Detection',
	caps: 'Caps Filter',
	links: 'Link Filter',
	invites: 'Invite Filter',
	mentions: 'Mass Mention Filter',
	'new-account': 'New Account Filter',
};

export const AUTOMOD_ACTIONS: AutomodAction[] = ['delete', 'delete_warn', 'delete_timeout'];

export const AUTOMOD_ACTION_LABELS: Record<AutomodAction, string> = {
	delete: 'Delete message only',
	delete_warn: 'Delete + Warn (infraction)',
	delete_timeout: 'Delete + Timeout + Infraction',
};

export type AutomodSettingsRow = typeof schema.automodSettings.$inferSelect;

// ─── In-memory spam tracker ───────────────────────────────────────────────────

/** Maps `guildId:userId` → array of message timestamps (ms) within the current window. */
const spamTracker = new Map<string, number[]>();

// ─── DB helpers ───────────────────────────────────────────────────────────────

export async function getOrCreateAutomodSettings(guildId: string): Promise<AutomodSettingsRow> {
	const existing = await db.query.automodSettings.findFirst({
		where: eq(schema.automodSettings.guildId, guildId),
	});
	if (existing) return existing;
	await db.insert(schema.automodSettings).values({ guildId });
	const [row] = await db
		.select()
		.from(schema.automodSettings)
		.where(eq(schema.automodSettings.guildId, guildId))
		.limit(1);
	return row!;
}

// ─── Action dispatcher ────────────────────────────────────────────────────────

async function applyAction(
	message: Message<true>,
	member: GuildMember,
	action: AutomodAction,
	timeoutMinutes: number,
	reason: string,
): Promise<void> {
	// Delete message first
	await message
		.delete()
		.then(() => {
			container.logger.info(
				`[AutoMod] Deleted message from ${member.user.tag} (${member.id}) in ${message.guild.name} for: ${reason}`,
			);
		})
		.catch((err) => {
			container.logger.error(`[AutoMod] Failed to delete message in ${message.guild.name}:`, err);
		});

	// DM the user using Components V2
	const dmContainer = makeContainer({ color: Colors.Error, header: 'Message Removed' });
	let dmBody = `Your message in **${message.guild.name}** was removed.\n\n**Reason** ${reason}`;

	if (action === 'delete_timeout') {
		dmBody += `\n\nYou have been timed out for **${timeoutMinutes} minute(s)**.`;
	} else if (action === 'delete_warn') {
		dmBody += '\n\nYou have received a formal warning.';
	}

	dmContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(dmBody));

	await member.user.send({ components: [dmContainer], flags: CV2_FLAG }).catch(() => null);

	if (action === 'delete') {
		const log = logContainer({
			title: 'AutoMod Message Deleted',
			color: Colors.Moderation,
			fields: [
				logFields.user(member.id),
				logFields.reason(reason),
				logFields.channel(message.channelId),
				logFields.message(message.content.slice(0, 300)),
			],
			timestamp: true,
			targetUser: member.user,
		});

		log.addActionRowComponents(...getModActionRow(member.id));

		await sendModLog(message.guild, log);
		return;
	}

	// Apply timeout
	if (action === 'delete_timeout') {
		await member.timeout(timeoutMinutes * 60 * 1000, `[AutoMod] ${reason}`).catch((err) => {
			container.logger.error(`[AutoMod] Failed to timeout ${member.user.tag}:`, err);
		});

		container.logger.info(`[AutoMod] Timed out ${member.user.tag} (${member.id}) for ${timeoutMinutes}m.`);
	}

	// Create infraction
	const infractionType = action === 'delete_timeout' ? 'timeout' : 'warn';
	const botId = message.guild.members.me?.id ?? 'SYSTEM';
	const infraction = await createInfraction({
		guildId: message.guildId,
		userId: member.id,
		moderatorId: botId,
		type: infractionType,
		reason: `[AutoMod] ${reason}`,
		duration: action === 'delete_timeout' ? timeoutMinutes * 60 * 1000 : undefined,
	});

	container.logger.info(`[AutoMod] Created infraction [Case: ${infraction.caseId}] for ${member.user.tag}.`);

	const log = logContainer({
		title: `AutoMod ${infractionType === 'timeout' ? 'Timeout' : 'Warning'}`,
		color: Colors.Moderation,
		fields: [
			logFields.user(member.id),
			logFields.reason(`[AutoMod] ${reason}`),
			logFields.channel(message.channelId),
			logFields.message(message.content.slice(0, 300)),
			logFields.case(infraction.caseId),
		],
		timestamp: true,
		targetUser: member.user,
	});

	log.addActionRowComponents(...getModActionRow(member.id, infractionType, infraction.caseId));

	await sendModLog(message.guild, log);
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function runAutomod(message: Message<true>): Promise<void> {
	try {
		// Ignore bot messages to prevent loops
		if (message.author.bot) return;

		const settings = await getOrCreateAutomodSettings(message.guildId);

		// Exempt channels
		const exemptChannels = JSON.parse(settings.exemptChannels || '[]') as string[];
		if (exemptChannels.includes(message.channelId)) return;

		const member =
			message.member ??
			(await message.guild.members.fetch(message.author.id).catch((err) => {
				container.logger.error(`[AutoMod] Failed to fetch member ${message.author.id}:`, err);
				return null;
			}));
		if (!member) return;

		// Administrator bypass
		if (member.permissions.has(PermissionFlagsBits.Administrator)) return;

		const exemptRoles = JSON.parse(settings.exemptRoles || '[]') as string[];
		if (exemptRoles.some((r) => member.roles.cache.has(r))) return;

		const content = message.content;

		// ── New account filter ────────────────────────────────────────────────────
		if (settings.newAccountEnabled) {
			const ageDays = (Date.now() - message.author.createdTimestamp) / 86_400_000;
			if (ageDays < settings.newAccountAgeDays) {
				return applyAction(
					message,
					member,
					settings.newAccountAction as AutomodAction,
					settings.newAccountTimeoutMinutes,
					`Account too new (${Math.floor(ageDays)}d old — minimum ${settings.newAccountAgeDays}d)`,
				);
			}
		}

		// ── Spam detection ────────────────────────────────────────────────────────
		if (settings.spamEnabled) {
			const key = `${message.guildId}:${message.author.id}`;
			const now = Date.now();
			const windowMs = settings.spamWindowSeconds * 1000;
			const timestamps = (spamTracker.get(key) ?? []).filter((t) => now - t < windowMs);
			timestamps.push(now);
			spamTracker.set(key, timestamps);
			if (timestamps.length >= settings.spamMaxMessages) {
				spamTracker.delete(key);
				return applyAction(
					message,
					member,
					settings.spamAction as AutomodAction,
					settings.spamTimeoutMinutes,
					`Sending too many messages (${settings.spamMaxMessages} in ${settings.spamWindowSeconds}s)`,
				);
			}
		}

		// ── Word filter ───────────────────────────────────────────────────────────
		if (settings.wordFilterEnabled) {
			const words = await db
				.select()
				.from(schema.automodWordFilter)
				.where(eq(schema.automodWordFilter.guildId, message.guildId));

			for (const entry of words) {
				let matched = false;
				if (entry.isRegex) {
					try {
						matched = new RegExp(entry.word, 'i').test(content);
					} catch {
						// invalid regex — skip silently
					}
				} else {
					matched = content.toLowerCase().includes(entry.word.toLowerCase());
				}
				if (matched) {
					return applyAction(
						message,
						member,
						settings.wordFilterAction as AutomodAction,
						settings.wordFilterTimeoutMinutes,
						'Message contained a blocked word or phrase',
					);
				}
			}
		}

		// ── Caps filter ───────────────────────────────────────────────────────────
		if (settings.capsEnabled) {
			const letters = content.replace(/[^a-zA-Z]/g, '');
			if (letters.length >= settings.capsMinLength) {
				const capsPercent = (letters.replace(/[^A-Z]/g, '').length / letters.length) * 100;
				if (capsPercent >= settings.capsPercent) {
					return applyAction(
						message,
						member,
						settings.capsAction as AutomodAction,
						settings.capsTimeoutMinutes,
						`Message was mostly uppercase (${Math.round(capsPercent)}%)`,
					);
				}
			}
		}

		// ── Invite filter ─────────────────────────────────────────────────────────
		if (settings.inviteEnabled) {
			const matches = content.matchAll(DiscordInviteLinkRegex);

			for (const match of matches) {
				const code = match.groups?.code;

				if (code?.toLowerCase() === 'aloramc') continue;

				return applyAction(
					message,
					member,
					settings.inviteAction as AutomodAction,
					settings.inviteTimeoutMinutes,
					'Message contained a Discord invite link',
				);
			}
		}

		// ── Link filter ───────────────────────────────────────────────────────────
		if (settings.linkEnabled) {
			const urlRegex = /https?:\/\/([^/\s]+)/gi;
			const whitelist = JSON.parse(settings.linkWhitelist) as string[];
			let match = urlRegex.exec(content);
			while (match !== null) {
				const domain = match[1].toLowerCase();
				const allowed = whitelist.some((w) => domain === w.toLowerCase() || domain.endsWith(`.${w.toLowerCase()}`));
				if (!allowed) {
					return applyAction(
						message,
						member,
						settings.linkAction as AutomodAction,
						settings.linkTimeoutMinutes,
						'Message contained a non-whitelisted link',
					);
				}
				match = urlRegex.exec(content);
			}
		}

		// ── Mass mention filter ───────────────────────────────────────────────────
		if (settings.mentionEnabled) {
			const uniqueMentions = new Set([...message.mentions.users.keys(), ...message.mentions.roles.keys()]);
			if (uniqueMentions.size >= settings.mentionMax) {
				return applyAction(
					message,
					member,
					settings.mentionAction as AutomodAction,
					settings.mentionTimeoutMinutes,
					`Too many mentions in one message (${uniqueMentions.size})`,
				);
			}
		}
	} catch (error) {
		container.logger.error('[AutoMod] Fatal error in runAutomod:', error);
	}
}
