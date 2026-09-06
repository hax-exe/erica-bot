import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ContainerBuilder,
	type GuildMember,
	type PartialGuildMember,
	SectionBuilder,
	TextDisplayBuilder,
	ThumbnailBuilder,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { Colors, separator } from './components.js';
import { db, schema } from './database.js';
import { resolveTag } from './TagManager.js';

// ─── Defaults ──────────────────────────────────────────────────────────────────

export const WELCOME_DEFAULTS = {
	title: 'Welcome',
	message: '{user} just joined **{server}**.',
	color: Colors.Success,
} as const;

export const LEAVE_DEFAULTS = {
	title: 'Goodbye',
	message: '**{username}** has left **{server}**.',
	color: Colors.Neutral,
} as const;

// ─── DB helpers ────────────────────────────────────────────────────────────────

export type WelcomeRow = typeof schema.welcomeSettings.$inferSelect;
export type LeaveRow = typeof schema.leaveSettings.$inferSelect;

export async function getWelcomeSettings(guildId: string): Promise<WelcomeRow | null> {
	return db
		.select()
		.from(schema.welcomeSettings)
		.where(eq(schema.welcomeSettings.guildId, guildId))
		.limit(1)
		.then((r) => r[0] ?? null);
}

export async function getLeaveSettings(guildId: string): Promise<LeaveRow | null> {
	return db
		.select()
		.from(schema.leaveSettings)
		.where(eq(schema.leaveSettings.guildId, guildId))
		.limit(1)
		.then((r) => r[0] ?? null);
}

export async function upsertWelcomeSettings(
	guildId: string,
	patch: Partial<typeof schema.welcomeSettings.$inferInsert>,
): Promise<void> {
	await db
		.insert(schema.welcomeSettings)
		.values({ guildId, ...patch })
		.onDuplicateKeyUpdate({ set: patch });
}

export async function upsertLeaveSettings(
	guildId: string,
	patch: Partial<typeof schema.leaveSettings.$inferInsert>,
): Promise<void> {
	await db
		.insert(schema.leaveSettings)
		.values({ guildId, ...patch })
		.onDuplicateKeyUpdate({ set: patch });
}

// ─── Placeholder resolution ────────────────────────────────────────────────────

/**
 * Supported placeholders:
 *   {user}     → <@id>  (mention)
 *   {username} → display name
 *   {tag}      → username / user tag
 *   {server}   → guild name
 *   {count}    → current member count
 *   {id}       → user ID
 */
export function resolvePlaceholders(template: string, member: GuildMember | PartialGuildMember): string {
	const displayName =
		(!member.partial ? (member as GuildMember).displayName : null) ??
		member.user?.globalName ??
		member.user?.username ??
		member.id;

	return template
		.replace(/{user}/g, `<@${member.id}>`)
		.replace(/{username}/g, displayName)
		.replace(/{tag}/g, member.user?.tag ?? member.id)
		.replace(/{server}/g, member.guild.name)
		.replace(/{count}/g, `${member.guild.memberCount}`)
		.replace(/{id}/g, member.id)
		.replace(/\\n/g, '\n');
}

// ─── Container builders ────────────────────────────────────────────────────────

/** Build the CV2 container for a welcome message. Optionally attach FAQ button if tag `faq` exists. */
export async function buildWelcomeContainer(row: WelcomeRow, member: GuildMember): Promise<ContainerBuilder> {
	const body = resolvePlaceholders(row.message ?? WELCOME_DEFAULTS.message, member);
	const title = resolvePlaceholders(row.title ?? WELCOME_DEFAULTS.title, member);
	const color = row.color ?? WELCOME_DEFAULTS.color;

	const container = new ContainerBuilder().setAccentColor(color);
	container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${title}`));
	container.addSeparatorComponents(separator());

	if (row.showAvatar) {
		// Use a Section so the avatar thumbnail sits beside the text
		const avatarUrl = member.displayAvatarURL({ size: 256, extension: 'png' });
		const section = new SectionBuilder()
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(body))
			.setThumbnailAccessory(new ThumbnailBuilder().setURL(avatarUrl));
		container.addSectionComponents(section);
	} else {
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
	}

	if (row.footer) {
		container.addSeparatorComponents(separator());
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(`-# ${resolvePlaceholders(row.footer, member)}`),
		);
	}

	const faq = await resolveTag(member.guild.id, 'faq');
	if (faq) {
		container.addSeparatorComponents(separator());
		container.addActionRowComponents(
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId(`welcome_faq:${member.guild.id}`)
					.setLabel('Server FAQ / Guide')
					.setStyle(ButtonStyle.Primary),
			),
		);
	}

	return container;
}

/** Build the CV2 container for a leave message. */
export function buildLeaveContainer(row: LeaveRow, member: GuildMember | PartialGuildMember): ContainerBuilder {
	const body = resolvePlaceholders(row.message ?? LEAVE_DEFAULTS.message, member);
	const title = resolvePlaceholders(row.title ?? LEAVE_DEFAULTS.title, member);
	const color = row.color ?? LEAVE_DEFAULTS.color;

	const container = new ContainerBuilder().setAccentColor(color);
	container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${title}`));
	container.addSeparatorComponents(separator());
	container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));

	if (row.footer) {
		container.addSeparatorComponents(separator());
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(`-# ${resolvePlaceholders(row.footer, member)}`),
		);
	}

	return container;
}
