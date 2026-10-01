import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import {
	ContainerBuilder,
	Events,
	type GuildMember,
	type PartialGuildMember,
	SectionBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
	TextDisplayBuilder,
	ThumbnailBuilder,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { CV2_FLAG } from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';
import { safeJsonParse } from '../../lib/safe.js';

const DEFAULT_MESSAGE = '🚀 {user} just boosted **{server}**! Thank you so much! 💜';

/** A boost whose premiumSince is newer than this is treated as new when the old member is uncached. */
const RECENT_BOOST_MS = 2 * 60_000;

function resolveBoostMessage(template: string, member: GuildMember, boostCount: number): string {
	return template
		.replace(/{user}/g, `<@${member.id}>`)
		.replace(/{username}/g, member.displayName)
		.replace(/{server}/g, member.guild.name)
		.replace(/{count}/g, String(boostCount))
		.replace(/{tier}/g, String(member.guild.premiumTier));
}

@ApplyOptions<Listener.Options>({
	name: 'boostAnnouncementUpdate',
	event: Events.GuildMemberUpdate,
})
export class BoostAnnouncementListener extends Listener<typeof Events.GuildMemberUpdate> {
	public override async run(oldMember: GuildMember | PartialGuildMember, newMember: GuildMember) {
		// Detect new boost: didn't have premium before, has it now.
		// A partial (uncached) old member has no premiumSince to compare against, so only count it
		// as a new boost when premiumSince is brand new — otherwise any update on an existing booster
		// would announce a false boost.
		const isBoosting = newMember.premiumSinceTimestamp != null;
		const wasBoosting = oldMember.partial
			? isBoosting && Date.now() - newMember.premiumSinceTimestamp! > RECENT_BOOST_MS
			: oldMember.premiumSince != null;
		if (wasBoosting || !isBoosting) return;

		const cfg = await db.query.boostSettings.findFirst({
			where: eq(schema.boostSettings.guildId, newMember.guild.id),
		});
		if (!cfg?.channelId) return;

		const boostCount = newMember.guild.premiumSubscriptionCount ?? 0;
		const text = resolveBoostMessage(cfg.message ?? DEFAULT_MESSAGE, newMember, boostCount);
		const avatarUrl = newMember.displayAvatarURL({ size: 128, extension: 'png' });

		// ── Boost card ───────────────────────────────────────────────────────────
		const container = new ContainerBuilder().setAccentColor(0xf47fff);
		const section = new SectionBuilder()
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(text))
			.setThumbnailAccessory(new ThumbnailBuilder().setURL(avatarUrl));
		container.addSectionComponents(section);
		container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`-# 🚀 ${boostCount} boost${boostCount === 1 ? '' : 's'} • Level ${newMember.guild.premiumTier}`,
			),
		);

		const channel = newMember.guild.channels.cache.get(cfg.channelId);
		if (channel?.isTextBased()) {
			// biome-ignore lint/suspicious/noExplicitAny: CV2 flag type gap
			await (channel as any).send({ components: [container], flags: CV2_FLAG }).catch(() => null);
		}

		// ── Milestone check ──────────────────────────────────────────────────────
		const milestones = safeJsonParse<number[]>(cfg.milestones, []);
		if (!milestones.includes(boostCount)) return;

		const milestoneChannelId = cfg.milestoneChannelId ?? cfg.channelId;
		const milestoneChannel = newMember.guild.channels.cache.get(milestoneChannelId);
		if (!milestoneChannel?.isTextBased()) return;

		const mc = new ContainerBuilder().setAccentColor(0xfee75c);
		mc.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### Milestone Reached`));
		mc.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
		mc.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`**${newMember.guild.name}** just hit **${boostCount} boosts**! 🚀\nThank you to everyone who has boosted the server!`,
			),
		);

		// biome-ignore lint/suspicious/noExplicitAny: CV2 flag type gap
		await (milestoneChannel as any).send({ components: [mc], flags: CV2_FLAG }).catch(() => null);
	}
}
