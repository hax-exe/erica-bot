/**
 * Components V2 design system.
 *
 * Design principles:
 *  - Accent bar signals status (no emoji prefix on every reply); informational cards and
 *    panels use the brand accent (`BRAND_COLOR`) so they read as one consistent family
 *  - Every card follows title -> body -> hint: a ### header (also on multi-line status replies),
 *    the content, then any -# hint lines at the very end
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
	escapeMarkdown,
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
import { BRAND_COLOR } from './brand.js';

/** The flag required for all Components V2 messages. */
export const CV2_FLAG = MessageFlags.IsComponentsV2;

// ─── Colour palette ────────────────────────────────────────────────────────────

export const Colors = {
	/** Brand accent (soft violet) — informational cards and panels */
	Info: BRAND_COLOR,
	/** Green — success / join */
	Success: 0x23a55a,
	/** Amber — warning / caution */
	Warning: 0xf0b232,
	/** Red — error / ban / destructive */
	Error: 0xf23f43,
	/** Orange — kick / timeout */
	Moderation: 0xeb6434,
	/** Invisible Neutral — minor events / loading states */
	Neutral: 0x2b2d31,
	/** Purple — ticket events */
	Ticket: 0x9b59b6,
	/** Teal — message events */
	Message: 0x1abc9c,
	/** Blurple — voice events */
	Voice: 0x5865f2,
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

/** Several `**Label** value` lines in one block — one `field()` per pair. */
export function fields(pairs: Array<[string, string]>): string {
	return pairs.map(([label, value]) => field(label, value)).join('\n');
}

/** Hint block — one `-# ` line per argument (not one dotted run-on line). Goes last in a card. */
export function hint(...lines: string[]): TextDisplayBuilder {
	return new TextDisplayBuilder().setContent(lines.map((line) => `-# ${line}`).join('\n'));
}

/** Breathing room inside a card without a visible divider. */
export function spacer(): SeparatorBuilder {
	return new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small);
}

/**
 * Card header: `### title` with an optional `-# subtitle` line.
 * With a thumbnail URL it is a Section with a thumbnail accessory (e.g. a user's avatar);
 * otherwise a plain TextDisplay, since a Section requires an accessory.
 */
export function headerSection(opts: {
	title: string;
	subtitle?: string;
	thumbnailUrl?: string | null;
}): SectionBuilder | TextDisplayBuilder {
	let content = `### ${plainHeader(opts.title)}`;
	if (opts.subtitle) content += `\n-# ${opts.subtitle}`;
	const text = new TextDisplayBuilder().setContent(content);
	if (!opts.thumbnailUrl) return text;
	return new SectionBuilder()
		.addTextDisplayComponents(text)
		.setThumbnailAccessory(new ThumbnailBuilder().setURL(opts.thumbnailUrl));
}

/** Inline code chips for short keyword lists: `` `a` `b` ``. Backticks in items are stripped. */
export function chips(items: string[]): string {
	return items
		.map((item) => item.replace(/`/g, ''))
		.filter((item) => item.length > 0)
		.map((item) => `\`${item}\``)
		.join(' ');
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

const HINT_PREFIX = '-#';

/**
 * Status reply structure: title -> body -> hint.
 * A single non-empty line is returned unchanged. Otherwise `-#` hint lines move to the end
 * after one blank line, and the other lines keep their order. The first line becomes a
 * `### title` (one trailing `.` or `:` dropped, ellipses kept) only when at least one non-hint body
 * line follows it and it contains no `**` (titling would invert the caller's emphasis).
 * Adds at most a few characters.
 */
export function formatStatus(message: string): string {
	const lines = message.split('\n');
	if (lines.filter((line) => line.trim().length > 0).length <= 1) return message;

	const isHint = (line: string) => line.trim().startsWith(HINT_PREFIX);
	const [first = '', ...rest] = lines;
	const main: string[] = [];
	const hints: string[] = [];

	const firstTrimmed = first.trim();
	const hasBody = rest.some((line) => line.trim().length > 0 && !isHint(line));
	if (isHint(first)) {
		hints.push(firstTrimmed);
	} else if (hasBody && firstTrimmed.length > 0 && !firstTrimmed.includes('**')) {
		const title =
			firstTrimmed.endsWith(':') || (firstTrimmed.endsWith('.') && !firstTrimmed.endsWith('..'))
				? firstTrimmed.slice(0, -1)
				: firstTrimmed;
		main.push(`### ${title}`);
	} else {
		main.push(first);
	}

	for (const line of rest) {
		if (isHint(line)) hints.push(line.trim());
		else main.push(line);
	}

	while (main.length > 0 && main[main.length - 1]?.trim() === '') main.pop();
	while (main.length > 0 && main[0]?.trim() === '') main.shift();

	if (hints.length === 0) return main.join('\n');
	if (main.length === 0) return hints.join('\n');
	return `${main.join('\n')}\n\n${hints.join('\n')}`;
}

export function errorReply(message: string, ephemeral = true): InteractionEditReplyOptions {
	const c = new ContainerBuilder().setAccentColor(Colors.Error);
	c.addTextDisplayComponents(new TextDisplayBuilder().setContent(formatStatus(plainHeader(message))));
	return cv2Reply(c, ephemeral);
}

export function successReply(message: string, ephemeral = true): InteractionEditReplyOptions {
	const c = new ContainerBuilder().setAccentColor(Colors.Success);
	c.addTextDisplayComponents(new TextDisplayBuilder().setContent(formatStatus(plainHeader(message))));
	return cv2Reply(c, ephemeral);
}

export function warningReply(message: string, ephemeral = true): InteractionEditReplyOptions {
	const c = new ContainerBuilder().setAccentColor(Colors.Warning);
	c.addTextDisplayComponents(new TextDisplayBuilder().setContent(formatStatus(plainHeader(message))));
	return cv2Reply(c, ephemeral);
}

export function loadingReply(message: string): InteractionEditReplyOptions {
	const c = new ContainerBuilder().setAccentColor(Colors.Neutral);
	c.addTextDisplayComponents(new TextDisplayBuilder().setContent(formatStatus(plainHeader(message))));
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

	// Callers sometimes pass a plain `{ id, username }` instead of a User — only call real avatar getters.
	if (targetUser && typeof targetUser.displayAvatarURL === 'function') {
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

/** Longest track title shown in music cards and lists before it is cut with `…`. */
export const TRACK_TITLE_MAX = 80;

/** Escape markdown, including `[` / `]`, so user-provided text can't break a masked link. */
export function escapeTrackText(text: string): string {
	return escapeMarkdown(text).replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

/** Backslash-escape a line-leading block marker (`#`, `-`, `>`, `*`, `+`, `1.`) so it can't become a heading/list/quote. */
export function escapeLineStart(text: string): string {
	return text.replace(/^(\s*)([#>+*-])/, '$1\\$2').replace(/^(\s*\d+)\./, '$1\\.');
}

/**
 * Track title as a masked link (`[title](uri)`), or the escaped title when there is no usable
 * http(s) URI. The title is cut to `maxLength` characters before escaping.
 */
export function trackLink(title: string, uri?: string | null, maxLength = TRACK_TITLE_MAX): string {
	const clean = title.replace(/\s+/g, ' ').trim() || 'Unknown';
	const cut = clean.length > maxLength ? `${clean.slice(0, maxLength - 1).trimEnd()}…` : clean;
	const text = escapeTrackText(cut);
	if (!uri || uri.length > 512 || !/^https?:\/\/\S+$/i.test(uri)) return text;
	return `[${text}](${uri.replace(/\(/g, '%28').replace(/\)/g, '%29')})`;
}

/**
 * Now Playing card — compact block: `-#` eyebrow, `###` track link, artist · album, one `-#` meta
 * line, artwork as the thumbnail, then the controls after a spacer.
 * No Unicode progress bars (Discord turns them into ugly scrubbers).
 */
export function musicTrackCard(opts: {
	/** Eyebrow text above the title, e.g. "Now playing" / "Paused". Defaults to "Now playing". */
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

	const eyebrow = plainHeader(opts.header?.trim() || 'Now playing');
	const lines: string[] = [`-# ${eyebrow}`, `### ${trackLink(opts.title, opts.uri)}`];

	const byline = [opts.author, opts.album]
		.map((part) => part?.trim())
		.filter((part): part is string => !!part)
		.map((part) => escapeTrackText(part.length > 100 ? `${part.slice(0, 99).trimEnd()}…` : part));
	if (byline.length) lines.push(escapeLineStart(byline.join(' · ')));

	// One quiet meta line: only positive / useful state — no "empty" / "off" noise
	const metaBits: string[] = [];
	const time =
		opts.position && opts.duration ? `${opts.position} / ${opts.duration}` : (opts.duration ?? opts.position ?? null);
	if (time) metaBits.push(time);
	if (opts.requesterMention) metaBits.push(`Requested by ${opts.requesterMention}`);
	if (opts.queueSize && opts.queueSize > 0) metaBits.push(`${opts.queueSize} up next`);
	if (opts.autoPlay) metaBits.push('Autoplay');
	if (metaBits.length) lines.push(meta(...metaBits));

	if (opts.body?.trim()) {
		lines.push('');
		lines.push(opts.body.trim());
	}

	const text = new TextDisplayBuilder().setContent(lines.join('\n'));
	if (opts.artworkUrl) {
		c.addSectionComponents(
			new SectionBuilder()
				.addTextDisplayComponents(text)
				.setThumbnailAccessory(new ThumbnailBuilder().setURL(opts.artworkUrl)),
		);
	} else {
		c.addTextDisplayComponents(text);
	}

	if (opts.withControls) {
		c.addSeparatorComponents(spacer());
		const [row1, row2] = musicControlRows({ paused: opts.paused, loopMode: opts.loopMode });
		c.addActionRowComponents(row1);
		c.addActionRowComponents(row2);
	}

	return c;
}

/** Idle jukebox panel (no track playing). */
export function idleJukeboxCard(): ContainerBuilder {
	const c = new ContainerBuilder().setAccentColor(Colors.Voice);
	c.addTextDisplayComponents(
		new TextDisplayBuilder().setContent(
			'-# Jukebox\n### Nothing playing\nSend a song name or link in this channel to start.',
		),
	);
	c.addSeparatorComponents(spacer());
	const [row1, row2] = musicControlRows();
	c.addActionRowComponents(row1);
	c.addActionRowComponents(row2);
	return c;
}

/**
 * Icon transport row + options menu — matches how production music bots present controls.
 * Labels are omitted so the row stays compact; emoji carries meaning. Only play/pause (and loop
 * while it is on) are Primary, so the active state stands out.
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
		new ButtonBuilder().setCustomId('music:stop').setEmoji('⏹').setStyle(ButtonStyle.Secondary),
	);
	const option = (label: string, value: string, emoji: string, description: string) =>
		new StringSelectMenuOptionBuilder().setLabel(label).setValue(value).setEmoji(emoji).setDescription(description);
	const row2 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
		new StringSelectMenuBuilder()
			.setCustomId('music:options')
			.setPlaceholder('More options')
			.addOptions(
				option('Queue', 'queue', '📜', "See what's up next"),
				option('Shuffle', 'shuffle', '🔀', 'Shuffle the queue'),
				option('Autoplay', 'autoplay', '♾️', 'Keep playing similar songs'),
				option('Clear queue', 'clear_queue', '🧹', 'Remove all upcoming tracks'),
				option('Volume', 'volume_modal', '🔊', 'Set the volume'),
				option('Bassboost', 'filter_bassboost', '🎚️', 'Boost the low end'),
				option('Nightcore', 'filter_nightcore', '⏩', 'Faster, higher pitch'),
				option('Vaporwave', 'filter_vaporwave', '🌊', 'Slower, lower pitch'),
				option('Clear filters', 'filter_clear', '✖️', 'Back to the original sound'),
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
