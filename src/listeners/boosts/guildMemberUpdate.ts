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

const DEFAULT_MESSAGE = '🚀 {user} just boosted **{server}**! Thank you so much! 💜';

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
		// Detect new boost: didn't have premium before, has it now
		const wasBoosting = oldMember.premiumSince != null;
		const isBoosting = newMember.premiumSince != null;
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
		const milestones: number[] = JSON.parse(cfg.milestones);
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
