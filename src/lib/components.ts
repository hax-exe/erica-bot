/**
 * Components V2 design system.
 *
 * Design principles:
 *  - Accent bar signals status (no emoji prefix on every reply)
 *  - ### for section headers (lighter weight than ##); leading emoji stripped via plainHeader()
 *  - **Label** value fields (no trailing colon)
 *  - -# for all metadata / footer lines
 *  - Separators only at true section boundaries
 *  - No Unicode progress/scrubber bars (▬🔘 █░) — use plain time or percent text
 */

import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ContainerBuilder,
	EmbedBuilder,
	type InteractionEditReplyOptions,
	MessageFlags,
	SectionBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
	StringSelectMenuBuilder,
	StringSelectMenuOptionBuilder,
	TextDisplayBuilder,
	ThumbnailBuilder,
	type User,
} from 'discord.js';

/** The flag required for all Components V2 messages. */
export const CV2_FLAG = MessageFlags.IsComponentsV2;

// ─── Colour palette ────────────────────────────────────────────────────────────

export const Colors = {
	/** Invisible / Neutral — default embed background */
	Info: 0x2b2d31,
	/** Sleek Green — success / join */
	Success: 0x43b581,
	/** Soft Amber — warning / caution */
	Warning: 0xfaa61a,
	/** Soft Red — error / ban / destructive */
	Error: 0xf04747,
	/** Orange — kick / timeout */
	Moderation: 0xeb6434,
	/** Invisible Neutral — minor events */
	Neutral: 0x2b2d31,
	/** Purple — ticket events */
	Ticket: 0x9b59b6,
	/** Teal — message events */
	Message: 0x1abc9c,
	/** Blurple — voice events */
	Voice: 0x7289da,
} as const;

/** Strip leading emoji / pictographs so accent color carries status, not decoration. */
export function plainHeader(text: string): string {
	const cleaned = text
		.replace(/^(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|\uFE0F|\u200D|\u20E3|\s)+/u, '')
		.trim();
	return cleaned || text.trim();
}

// ─── Layout primitives ─────────────────────────────────────────────────────────

/** Thin divider with small spacing — use only at major section breaks. */
export function separator(): SeparatorBuilder {
	return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

/**
 * `**Label** value` — clean key/value line with no trailing colon.
 * Use inside a TextDisplay block, not as standalone components.
 */
export function field(label: string, value: string): string {
	return `**${label}** ${value}`;
}

/** `-# key · value · value` — compact metadata / footnote line. */
export function meta(...parts: string[]): string {
	return `-# ${parts.join(' · ')}`;
}

// ─── Container factory ─────────────────────────────────────────────────────────

/**
 * Top-level Container with optional accent colour and section header.
 * Header is rendered at `###` weight — present but not dominant.
 * Leading emoji on headers are stripped (accent color conveys status).
 */
export function makeContainer(options: { color?: number; header?: string }): ContainerBuilder {
	const container = new ContainerBuilder();
	if (options.color !== undefined) container.setAccentColor(options.color);
	if (options.header) {
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${plainHeader(options.header)}`));
	}
	return container;
}

// ─── Reply helpers ─────────────────────────────────────────────────────────────
// Accent bar conveys status — no emoji prefix needed.

export function cv2Reply(container: ContainerBuilder, ephemeral = false): InteractionEditReplyOptions {
	return {
		components: [container],
		// biome-ignore lint/suspicious/noExplicitAny: Discord.js CV2 flag type gap
		flags: (ephemeral ? CV2_FLAG | MessageFlags.Ephemeral : CV2_FLAG) as any,
	};
}

export function errorReply(message: string, ephemeral = true): InteractionEditReplyOptions {
	const c = new ContainerBuilder().setAccentColor(Colors.Error);
	c.addTextDisplayComponents(new TextDisplayBuilder().setContent(plainHeader(message)));
	return cv2Reply(c, ephemeral);
}

export function successReply(message: string, ephemeral = true): InteractionEditReplyOptions {
	const c = new ContainerBuilder().setAccentColor(Colors.Success);
	c.addTextDisplayComponents(new TextDisplayBuilder().setContent(plainHeader(message)));
	return cv2Reply(c, ephemeral);
}

export function warningReply(message: string, ephemeral = true): InteractionEditReplyOptions {
	const c = new ContainerBuilder().setAccentColor(Colors.Warning);
	c.addTextDisplayComponents(new TextDisplayBuilder().setContent(plainHeader(message)));
	return cv2Reply(c, ephemeral);
}

export function loadingReply(message: string): InteractionEditReplyOptions {
	const c = new ContainerBuilder().setAccentColor(Colors.Neutral);
	c.addTextDisplayComponents(new TextDisplayBuilder().setContent(plainHeader(message)));
	return cv2Reply(c);
}

// ─── Log container ─────────────────────────────────────────────────────────────

export class LogEmbed extends EmbedBuilder {
	public components?: any[];
	public images?: string[];

	public addActionRowComponents(...components: any[]) {
		if (!this.components) this.components = [];
		this.components.push(...components);
		return this;
	}

	public addMediaGalleryComponents(gallery: any) {
		if (gallery && gallery.items) {
			this.images = gallery.items.map((item: any) => item.data?.media?.url || item.data?.url).filter(Boolean);
			if (this.images && this.images.length > 0) {
				this.setImage(this.images[0]);
			}
		}
		return this;
	}

	public addSeparatorComponents() {
		return this;
	}
}

const BLOCK_FIELD_NAMES = new Set([
	'content',
	'message',
	'old message',
	'new message',
	'reason',
	'description',
	'before',
	'after',
	'changes',
	'details',
	'invite used',
	'transcript',
]);

/** Normalize drifted field labels so every log speaks the same vocabulary. */
const FIELD_NAME_ALIASES: Record<string, string> = {
	author: 'User',
	'message author': 'User',
	member: 'User',
	by: 'Changed By',
	'case id': 'Case',
	members: 'Member Count',
	'member count': 'Member Count',
	'message created': 'Message Created',
	'account created': 'Account Created',
	'previous avatar': 'Old Avatar',
	'new avatar': 'New Avatar',
	old: 'Before',
	new: 'After',
	'jump to message': 'Jump',
	'click to view': 'Jump',
	'opened by': 'Opened By',
	'closed by': 'Closed By',
	'changed by': 'Changed By',
	'deleted by': 'Deleted By',
	'created by': 'Created By',
	'updated by': 'Updated By',
	'ticket id': 'Ticket ID',
	'message id': 'Message ID',
};

function canonicalizeFieldName(name: string): string {
	const stripped = name
		.replace(/^(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|\uFE0F|\u200D|\u20E3|\s)+/u, '')
		.trim();
	const aliased = FIELD_NAME_ALIASES[stripped.toLowerCase()];
	if (aliased) return aliased;
	// Title-case multi-word labels that are already close
	return stripped.replace(/\bid\b/gi, 'ID');
}

function isBlockField(name: string, value: string): boolean {
	const lower = name.toLowerCase();
	if (BLOCK_FIELD_NAMES.has(lower)) return true;
	if (lower.includes('description')) return true;
	if (value.includes('\n') || value.length > 120) return true;
	return false;
}

function formatFieldValue(name: string, value: string): string {
	let val = value.trim() || '*(none)*';

	// Discord timestamps already render as compact, readable timestamp pills.
	// Never wrap them in code formatting or they stop resolving.
	val = val.replace(/`(<t:\d+:[A-Za-z]>)`/g, '$1');

	const lowerName = name.toLowerCase();
	if ((lowerName === 'id' || lowerName.endsWith(' id')) && /^\d+$/.test(val)) {
		val = `\`${val}\``;
	}
	return val;
}

/**
 * Canonical Sapphire-style audit card:
 * - event-colored rail
 * - clear event title
 * - compact quoted key/value summary
 * - full-width body fields for long content
 * - relevant target thumbnail and timestamp
 */
export function logContainer(options: {
	title: string;
	color: number;
	fields: Array<{ name: string; value: string }>;
	footer?: string;
	footerText?: string;
	footerIconUrl?: string;
	timestamp?: boolean;
	thumbnailUrl?: string;
	executor?: any;
	targetUser?: any;
	entry?: import('discord.js').GuildAuditLogsEntry | null;
}): LogEmbed {
	const embed = new LogEmbed().setColor(options.color).setTitle(plainHeader(options.title));

	let executor: any = options.executor;
	let targetUser: any = options.targetUser;

	if (options.entry) {
		if (!executor && options.entry.executor) {
			executor = options.entry.executor;
		}
		if (!targetUser && options.entry.targetType === 'User' && options.entry.target) {
			targetUser = options.entry.target as User;
		}
	}

	if (targetUser) {
		embed.setThumbnail(targetUser.displayAvatarURL({ forceStatic: false }));
	} else if (options.thumbnailUrl) {
		embed.setThumbnail(options.thumbnailUrl);
	}

	const summaryLines: string[] = [];
	const blockFields: { name: string; value: string; inline: false }[] = [];

	for (const f of options.fields) {
		const name = canonicalizeFieldName(f.name);
		const value = formatFieldValue(name, f.value);
		if (isBlockField(name, value)) {
			blockFields.push({
				name,
				value: value.length > 1024 ? `${value.slice(0, 1021)}…` : value,
				inline: false,
			});
		} else {
			const line = `> **${name}:** ${value}`;
			const currentLength = summaryLines.join('\n').length;
			if (currentLength + line.length + 1 <= 3900) {
				summaryLines.push(line);
			} else {
				blockFields.push({
					name,
					value: value.length > 1024 ? `${value.slice(0, 1021)}…` : value,
					inline: false,
				});
			}
		}
	}

	if (summaryLines.length > 0) embed.setDescription(summaryLines.join('\n'));
	if (blockFields.length > 0) embed.addFields(...blockFields.slice(0, 25));

	if (options.footer) {
		embed.setFooter({ text: options.footer });
	} else if (options.footerText) {
		embed.setFooter({
			text: options.footerText,
			iconURL: options.footerIconUrl,
		});
	} else if (executor) {
		const executorName = executor.username ?? executor.displayName ?? 'Unknown';
		embed.setFooter({
			text: `Performed by ${executorName}${executor.id ? ` • ${executor.id}` : ''}`,
			iconURL:
				typeof executor.displayAvatarURL === 'function' ? executor.displayAvatarURL({ forceStatic: true }) : undefined,
		});
	}

	// Every log gets an exact native timestamp unless explicitly disabled.
	if (options.timestamp !== false) {
		embed.setTimestamp();
	}

	return embed;
}

/**
 * Wrap a log embed for dispatch to a log webhook.
 * Sets allowedMentions to silence all pings.
 */
export function logMessage(embed: LogEmbed): {
	embeds: any[];
	components?: any[];
	allowedMentions: { parse: [] };
} {
	const embeds = [embed.toJSON()];

	if (embed.images && embed.images.length > 1) {
		const url = embed.data.url || 'https://example.com';
		if (!embed.data.url) {
			embed.setURL(url);
		}
		for (const imgUrl of embed.images.slice(1)) {
			const extraEmbed = new EmbedBuilder().setURL(embed.data.url || url).setImage(imgUrl);
			if (embed.data.color) {
				extraEmbed.setColor(embed.data.color);
			}
			embeds.push(extraEmbed.toJSON());
		}
	}

	const payload: any = {
		embeds,
		allowedMentions: { parse: [] },
	};

	if (embed.components && embed.components.length > 0) {
		payload.components = embed.components;
	}

	return payload;
}

// ─── Confirm / cancel row ──────────────────────────────────────────────────────

export function confirmCancelRow(confirmId: string, cancelId: string): ActionRowBuilder<ButtonBuilder> {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder().setCustomId(confirmId).setLabel('Confirm').setStyle(ButtonStyle.Danger),
		new ButtonBuilder().setCustomId(cancelId).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
	);
}

// ─── Music player card ─────────────────────────────────────────────────────────

export type MusicLoopMode = 'off' | 'track' | 'queue';

/**
 * Now Playing card — title + artwork, quiet meta, icon transport controls.
 * No Unicode progress bars (Discord turns them into ugly scrubbers).
 */
export function musicTrackCard(opts: {
	header?: string;
	color: number;
	title: string;
	uri?: string | null;
	author?: string | null;
	album?: string | null;
	requesterMention?: string;
	/** Elapsed time, e.g. "0:42". Shown with duration as `0:42 / 3:18`. */
	position?: string | null;
	duration?: string | null;
	/** Only surfaced when true — never print "Autoplay off". */
	autoPlay?: boolean;
	/** Only surfaced when > 0 — never print "Queue empty". */
	queueSize?: number;
	body?: string;
	/** @deprecated Prefer loopMode on controls; ignored in footer. */
	statusBadges?: string;
	artworkUrl?: string | null;
	withControls?: boolean;
	paused?: boolean;
	loopMode?: MusicLoopMode;
	/** @deprecated Ignored — kept so old call sites type-check until cleaned up. */
	progressBar?: string;
}): ContainerBuilder {
	const c = new ContainerBuilder().setAccentColor(opts.color);

	const header = opts.header?.trim();
	if (header) {
		c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${plainHeader(header)}`));
		c.addSeparatorComponents(separator());
	}

	const titleLine = opts.uri ? `**[${opts.title}](${opts.uri})**` : `**${opts.title}**`;
	const lines: string[] = [titleLine];

	if (opts.author || opts.album) {
		lines.push([opts.author, opts.album].filter(Boolean).join(' · '));
	}

	const timeLine =
		opts.position && opts.duration ? `${opts.position} / ${opts.duration}` : (opts.duration ?? opts.position ?? null);
	if (timeLine) lines.push(meta(timeLine));

	// Footer: only positive / useful state — no "empty" / "off" noise
	const stateBits: string[] = [];
	if (opts.requesterMention) stateBits.push(`Requested by ${opts.requesterMention}`);
	if (opts.queueSize && opts.queueSize > 0) {
		stateBits.push(`${opts.queueSize} in queue`);
	}
	if (opts.autoPlay) stateBits.push('Autoplay');
	if (stateBits.length) lines.push(meta(...stateBits));

	if (opts.body?.trim()) {
		lines.push('');
		lines.push(opts.body.trim());
	}

	const section = new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
	if (opts.artworkUrl) section.setThumbnailAccessory(new ThumbnailBuilder().setURL(opts.artworkUrl));
	c.addSectionComponents(section);

	if (opts.withControls) {
		c.addSeparatorComponents(separator());
		const [row1, row2] = musicControlRows({ paused: opts.paused, loopMode: opts.loopMode });
		c.addActionRowComponents(row1);
		c.addActionRowComponents(row2);
	}

	return c;
}

/** Idle jukebox panel (no track playing). */
export function idleJukeboxCard(): ContainerBuilder {
	const c = makeContainer({ color: Colors.Voice, header: 'Jukebox' });
	c.addSeparatorComponents(separator());
	c.addTextDisplayComponents(
		new TextDisplayBuilder().setContent('Nothing playing.\nSend a **song name** or **link** in this channel to start.'),
	);
	c.addSeparatorComponents(separator());
	const [row1, row2] = musicControlRows();
	c.addActionRowComponents(row1);
	c.addActionRowComponents(row2);
	return c;
}

/**
 * Icon transport row + options menu — matches how production music bots present controls.
 * Labels are omitted so the row stays compact; emoji carries meaning.
 */
export function musicControlRows(
	opts: { paused?: boolean; loopMode?: MusicLoopMode } = {},
): [ActionRowBuilder<ButtonBuilder>, ActionRowBuilder<StringSelectMenuBuilder>] {
	const looping = opts.loopMode === 'track' || opts.loopMode === 'queue';
	const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder().setCustomId('music:previous').setEmoji('⏮').setStyle(ButtonStyle.Secondary),
		new ButtonBuilder()
			.setCustomId('music:toggle')
			.setEmoji(opts.paused ? '▶' : '⏸')
			.setStyle(ButtonStyle.Primary),
		new ButtonBuilder().setCustomId('music:skip').setEmoji('⏭').setStyle(ButtonStyle.Secondary),
		new ButtonBuilder()
			.setCustomId('music:loop')
			.setEmoji(opts.loopMode === 'track' ? '🔂' : '🔁')
			.setStyle(looping ? ButtonStyle.Primary : ButtonStyle.Secondary),
		new ButtonBuilder().setCustomId('music:stop').setEmoji('⏹').setStyle(ButtonStyle.Danger),
	);
	const row2 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
		new StringSelectMenuBuilder()
			.setCustomId('music:options')
			.setPlaceholder('Options')
			.addOptions(
				new StringSelectMenuOptionBuilder().setLabel('Queue').setValue('queue'),
				new StringSelectMenuOptionBuilder().setLabel('Shuffle').setValue('shuffle'),
				new StringSelectMenuOptionBuilder().setLabel('Autoplay').setValue('autoplay'),
				new StringSelectMenuOptionBuilder().setLabel('Clear queue').setValue('clear_queue'),
				new StringSelectMenuOptionBuilder().setLabel('Volume').setValue('volume_modal'),
				new StringSelectMenuOptionBuilder().setLabel('Bassboost').setValue('filter_bassboost'),
				new StringSelectMenuOptionBuilder().setLabel('Nightcore').setValue('filter_nightcore'),
				new StringSelectMenuOptionBuilder().setLabel('Vaporwave').setValue('filter_vaporwave'),
				new StringSelectMenuOptionBuilder().setLabel('Clear filters').setValue('filter_clear'),
			),
	);
	return [row1, row2];
}

/** Compact Previous / Next navigation — icon-only. */
export function pageNavRow(
	prevId: string,
	nextId: string,
	opts: { atStart?: boolean; atEnd?: boolean } = {},
): ActionRowBuilder<ButtonBuilder> {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder().setCustomId(prevId).setEmoji('◀').setStyle(ButtonStyle.Secondary).setDisabled(!!opts.atStart),
		new ButtonBuilder().setCustomId(nextId).setEmoji('▶').setStyle(ButtonStyle.Secondary).setDisabled(!!opts.atEnd),
	);
}
