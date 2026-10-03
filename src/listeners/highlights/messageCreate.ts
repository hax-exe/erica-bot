import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import {
	ChannelType,
	Events,
	type GuildMember,
	type GuildTextBasedChannel,
	type Message,
	PermissionFlagsBits,
} from 'discord.js';
import { isBotBlacklisted } from '../../lib/BlacklistUtil.js';
import {
	buildHighlightDm,
	classifyDmError,
	clearNotified,
	consumeDmBudget,
	findHighlightMatches,
	getGuildHighlights,
	hasDmBudget,
	hasRecentActivity,
	isHighlightDmPaused,
	isMemberMissing,
	isUnknownMemberError,
	markMemberMissing,
	markNotified,
	pauseHighlightDms,
	RecipientCap,
	recordActivity,
	refundDmBudget,
	wasRecentlyNotified,
} from '../../lib/HighlightUtil.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';
import { findPhishingDomain, getPhishingDomains } from '../../lib/PhishingUtil.js';

/** True when the member can see the channel (or thread) and read its history. */
async function canReadChannel(channel: GuildTextBasedChannel, member: GuildMember): Promise<boolean> {
	// For a thread, discord.js resolves permissions through its parent channel.
	const permissions = channel.permissionsFor(member);
	if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])) return false;

	// A private thread is visible only to its members and to members who can manage threads.
	if (channel.isThread() && channel.type === ChannelType.PrivateThread) {
		if (permissions.has(PermissionFlagsBits.ManageThreads)) return true;
		if (channel.members.cache.has(member.id)) return true;
		return channel.members.fetch({ member: member.id }).then(
			() => true,
			() => false,
		);
	}
	return true;
}

@ApplyOptions<Listener.Options>({
	name: 'highlightsMessageCreate',
	event: Events.MessageCreate,
})
export class HighlightsMessageCreateListener extends Listener<typeof Events.MessageCreate> {
	public override async run(message: Message) {
		if (!message.inGuild() || message.author.bot || !message.content) return;

		const { guild, guildId, channel, channelId, author } = message;
		const now = Date.now();

		// Hot path: every guild message lands here. Activity is recorded first (a Map write), then the
		// cached keyword list ends the run for guilds with no highlights before any module / DB lookup.
		recordActivity(channelId, author.id, now);

		const entries = await getGuildHighlights(guildId);
		if (entries.length === 0) return;
		if (isHighlightDmPaused()) return; // Discord said we are opening DMs too fast
		if (!(await isModuleEnabled(guildId, 'highlights'))) return;

		const matches = findHighlightMatches(message.content, entries, author.id);
		if (matches.length === 0) return;

		// The DM quotes the message, so a member could use it to push a scam link to every subscriber.
		if (findPhishingDomain(message.content, getPhishingDomains(), [])) return;

		// In-memory filters first: mentioned members, recent posters in this channel, recently notified,
		// and members whose highlight DM budget is used up.
		const candidates = matches.filter(
			({ userId }) =>
				!message.mentions.users.has(userId) &&
				!hasRecentActivity(channelId, userId, now) &&
				!wasRecentlyNotified(channelId, userId, now) &&
				hasDmBudget(userId, now) &&
				!isMemberMissing(guildId, userId, now),
		);
		if (candidates.length === 0) return;

		if (await isBotBlacklisted(author.id)) return;

		// Candidates keep keyword match order; once the recipient cap or the per-message check limit is
		// reached the rest are skipped.
		const cap = new RecipientCap();
		for (const { userId, keyword } of candidates) {
			if (cap.isFull) break;
			cap.beginCheck();
			try {
				const member =
					guild.members.cache.get(userId) ??
					(await guild.members.fetch(userId).catch((error: unknown) => {
						// 10007: left the guild. Remember it so every later message does not cost an API call.
						if (isUnknownMemberError(error)) markMemberMissing(guildId, userId);
						return null;
					}));
				if (!member || member.user.bot) continue;
				if (!(await canReadChannel(channel, member))) continue;
				if (await isBotBlacklisted(userId)) continue;

				// A concurrent message may have hit the DM rate limit while this one was awaiting.
				if (isHighlightDmPaused()) break;
				// No await between these checks and the marks, so concurrent messages cannot both notify
				// the same member or overspend their budget.
				if (wasRecentlyNotified(channelId, userId)) continue;
				const sentAt = Date.now();
				if (!consumeDmBudget(userId, sentAt)) continue;
				markNotified(channelId, userId, sentAt);
				cap.take();

				try {
					await member.send(
						buildHighlightDm({ keyword, channelId, authorId: author.id, content: message.content, url: message.url }),
					);
				} catch (error) {
					// A failed send does not count against the member's budget.
					refundDmBudget(userId, sentAt);
					const failure = classifyDmError(error);
					if (failure === 'too-fast') {
						// 40003: the member was not reached, so let a later message retry; stop for this message
						// and pause every highlight DM for a minute.
						clearNotified(channelId, userId);
						cap.halt();
						if (pauseHighlightDms()) {
							this.container.logger.warn(
								'[highlights] Discord reports DMs are opened too fast; pausing highlight DMs for 60 s',
							);
						}
					} else if (failure === 'other') {
						this.container.logger.warn(`[highlights] Failed to DM ${userId} in ${guildId}:`, error);
					}
					// 'closed' (50007): DMs closed or bot blocked. The member stays marked as notified for this
					// channel, so the DM is not retried on every message.
				}
			} catch (error) {
				this.container.logger.warn(`[highlights] Failed to notify ${userId} in ${guildId}:`, error);
			}
		}
	}
}
