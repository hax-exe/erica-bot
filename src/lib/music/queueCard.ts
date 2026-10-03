import { type ContainerBuilder, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder } from 'discord.js';
import { Colors, escapeTrackText, hint, makeContainer, spacer, trackLink } from '../components.js';
import { formatDuration } from '../MusicManager.js';

/** The track fields the queue, history and playlist views read. */
export interface QueueTrackLike {
	title?: string | null;
	uri?: string | null;
	author?: string | null;
	duration?: number | null;
	isStream?: boolean;
	position?: number | null;
	artworkUrl?: string | null;
}

/** Text budget for one card's list (Discord caps a CV2 message at 4000 text characters). */
const LIST_BUDGET = 3200;

function plural(n: number, word: string): string {
	return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function trackDuration(t: QueueTrackLike): string {
	return t.isStream ? 'LIVE' : formatDuration(t.duration ?? 0);
}

/** `-# author · duration`, with the author escaped and shortened. */
export function trackMetaLine(t: QueueTrackLike): string {
	const author = t.author?.trim();
	const shortAuthor = author && author.length > 80 ? `${author.slice(0, 79).trimEnd()}…` : author;
	return `-# ${[shortAuthor ? escapeTrackText(shortAuthor) : null, trackDuration(t)].filter(Boolean).join(' · ')}`;
}

/**
 * Numbered two-line track items (`n. [title](uri)` then `-# author · duration`), kept within
 * `budget` characters. Items that would overflow fall back to a plain title, then stop with an
 * `… and N more` line.
 */
export function trackItemLines(tracks: QueueTrackLike[], startNumber = 1, budget = LIST_BUDGET): string[] {
	const lines: string[] = [];
	let used = 0;
	for (const [i, t] of tracks.entries()) {
		const n = startNumber + i;
		const metaLine = trackMetaLine(t);
		const title = t.title ?? 'Unknown';
		let item = `${n}. ${trackLink(title, t.uri)}\n${metaLine}`;
		if (used + item.length + 1 > budget) item = `${n}. ${trackLink(title, null)}\n${metaLine}`;
		if (used + item.length + 1 > budget) {
			lines.push(`-# … and ${tracks.length - i} more`);
			break;
		}
		lines.push(item);
		used += item.length + 1;
	}
	return lines;
}

/**
 * Queue card shared by `/queue` and the player's Queue option.
 * The caller filters / pages the tracks and adds any navigation row.
 */
export function buildQueueCard(opts: {
	/** Current track, or null when it is hidden (nothing playing, or it doesn't match the query). */
	current: QueueTrackLike | null | undefined;
	paused: boolean;
	/** All (filtered) upcoming tracks. */
	tracks: QueueTrackLike[];
	/** Zero-based page index (already clamped). */
	page: number;
	pageSize: number;
	/** Search query; switches the header and labels to search results. */
	query?: string | null;
	loopMode?: string | null;
	autoPlay?: boolean;
}): ContainerBuilder {
	const { current, tracks, page, pageSize, query } = opts;
	const totalPages = Math.max(1, Math.ceil(tracks.length / pageSize));
	const start = page * pageSize;
	const slice = tracks.slice(start, start + pageSize);

	const c = makeContainer({ color: Colors.Voice, header: query ? 'Search results' : 'Queue' });
	const shownQuery = query ? escapeTrackText(query.length > 80 ? `${query.slice(0, 79)}…` : query) : null;
	if (shownQuery && slice.length > 0) {
		c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Matching "${shownQuery}"`));
	}

	if (current) {
		const text = new TextDisplayBuilder().setContent(
			[
				`-# ${opts.paused ? 'Paused' : 'Now playing'}`,
				`**${trackLink(current.title ?? 'Unknown', current.uri)}**`,
				trackMetaLine(current),
			].join('\n'),
		);
		if (current.artworkUrl) {
			c.addSectionComponents(
				new SectionBuilder()
					.addTextDisplayComponents(text)
					.setThumbnailAccessory(new ThumbnailBuilder().setURL(current.artworkUrl)),
			);
		} else {
			c.addTextDisplayComponents(text);
		}
		c.addSeparatorComponents(spacer());
	}

	if (slice.length > 0) {
		const items = trackItemLines(slice, start + 1);
		c.addTextDisplayComponents(new TextDisplayBuilder().setContent(['**Up next**', ...items].join('\n')));
	} else if (!current) {
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(shownQuery ? `No tracks match "${shownQuery}".` : 'The queue is empty.'),
		);
	}

	const hints: string[] = [];
	if (tracks.length > 0 || current) {
		const queueMs = tracks.reduce((acc, t) => acc + (t.isStream ? 0 : (t.duration ?? 0)), 0);
		const currentMs =
			current && !current.isStream && current.duration ? Math.max(0, current.duration - (current.position ?? 0)) : 0;
		const count = query
			? `${tracks.length} ${tracks.length === 1 ? 'match' : 'matches'}`
			: plural(tracks.length, 'track');
		hints.push(`${count} · ${formatDuration(queueMs + currentMs)} left`);
	}
	const state: string[] = [];
	if (totalPages > 1) state.push(`Page ${page + 1} of ${totalPages}`);
	if (opts.loopMode === 'track') state.push('Loop: track');
	else if (opts.loopMode === 'queue') state.push('Loop: queue');
	if (opts.autoPlay) state.push('Autoplay');
	if (state.length) hints.push(state.join(' · '));
	if (hints.length) c.addTextDisplayComponents(hint(...hints));

	return c;
}
