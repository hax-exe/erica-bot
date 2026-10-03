import { describe, expect, test } from 'bun:test';
import { ComponentType, SectionBuilder, TextDisplayBuilder } from 'discord.js';
import { BRAND_COLOR } from './brand.js';
import {
	Colors,
	chips,
	errorReply,
	escapeLineStart,
	fields,
	formatStatus,
	headerSection,
	hint,
	musicControlRows,
	musicTrackCard,
	spacer,
	trackLink,
} from './components.js';

describe('formatStatus', () => {
	test('single line is unchanged', () => {
		expect(formatStatus('Saved.')).toBe('Saved.');
		expect(formatStatus('You need **Manage Server** to do that.')).toBe('You need **Manage Server** to do that.');
	});

	test('single non-empty line with blank lines is unchanged', () => {
		expect(formatStatus('Saved.\n')).toBe('Saved.\n');
	});

	test('first line becomes a ### title and the rest is the body', () => {
		expect(formatStatus('Verification enabled\nNew members must pass the captcha.')).toBe(
			'### Verification enabled\nNew members must pass the captcha.',
		);
	});

	test('one trailing period is removed from the title', () => {
		expect(formatStatus('Could not save.\nTry again later.')).toBe('### Could not save\nTry again later.');
	});

	test('one trailing colon is removed from the title', () => {
		expect(formatStatus('Configs reloaded:\nTickets, status')).toBe('### Configs reloaded\nTickets, status');
	});

	test('ellipsis in the title is kept', () => {
		expect(formatStatus('Loading...\nFetching data.')).toBe('### Loading...\nFetching data.');
	});

	test('hint lines move to the end after a blank line', () => {
		expect(formatStatus('Title\n-# first hint\nBody one\n-# second hint\nBody two')).toBe(
			'### Title\nBody one\nBody two\n\n-# first hint\n-# second hint',
		);
	});

	test('sentence plus hint only is not titled', () => {
		expect(formatStatus('Saved your settings.\n-# Use /config to change them')).toBe(
			'Saved your settings.\n\n-# Use /config to change them',
		);
	});

	test('no trailing blank lines', () => {
		expect(formatStatus('Title\nBody\n\n')).toBe('### Title\nBody');
	});

	test('already-bold title is untouched', () => {
		expect(formatStatus('**Done.**\nBody')).toBe('**Done.**\nBody');
	});

	test('first line containing ** anywhere is not titled', () => {
		expect(formatStatus('You need **Manage Server**.\nAsk an admin.')).toBe(
			'You need **Manage Server**.\nAsk an admin.',
		);
	});

	test('leading -# line is not titled', () => {
		expect(formatStatus('-# a hint\nBody line\nAnother')).toBe('Body line\nAnother\n\n-# a hint');
	});

	test('only hints stays a hint block', () => {
		expect(formatStatus('-# one\n-# two')).toBe('-# one\n-# two');
	});

	test('status replies use the formatter and the new palette', () => {
		const reply = errorReply('Failed.\nDetails here.\n-# Try again');
		const first = (reply.components ?? [])[0] as unknown as { toJSON(): unknown };
		const container = first.toJSON() as {
			accent_color: number;
			components: Array<{ content: string }>;
		};
		expect(container.accent_color).toBe(0xf23f43);
		expect(container.components[0]?.content).toBe('### Failed\nDetails here.\n\n-# Try again');
	});
});

describe('palette', () => {
	test('Info is the brand accent', () => {
		expect(Colors.Info).toBe(BRAND_COLOR);
		expect(BRAND_COLOR).toBe(0x8b7cf6);
	});
});

describe('helpers', () => {
	test('chips wraps items in inline code and strips backticks', () => {
		expect(chips(['a', 'b c'])).toBe('`a` `b c`');
		expect(chips(['x`y'])).toBe('`xy`');
		expect(chips([])).toBe('');
	});

	test('fields joins field lines', () => {
		expect(
			fields([
				['Role', '@Member'],
				['Channel', '#general'],
			]),
		).toBe('**Role** @Member\n**Channel** #general');
	});

	test('hint prefixes every line', () => {
		const json = hint('one', 'two').toJSON();
		expect(json.type).toBe(ComponentType.TextDisplay);
		expect(json.content).toBe('-# one\n-# two');
	});

	test('spacer has no divider', () => {
		const json = spacer().toJSON();
		expect(json.type).toBe(ComponentType.Separator);
		expect(json.divider).toBe(false);
	});

	test('headerSection without thumbnail is a TextDisplay', () => {
		const h = headerSection({ title: 'Invites', subtitle: 'kiana' });
		expect(h).toBeInstanceOf(TextDisplayBuilder);
		const json = h.toJSON() as { type: number; content: string };
		expect(json.type).toBe(ComponentType.TextDisplay);
		expect(json.content).toBe('### Invites\n-# kiana');
	});

	test('headerSection with thumbnail is a Section with a thumbnail accessory', () => {
		const h = headerSection({ title: 'Invites', thumbnailUrl: 'https://cdn.discordapp.com/avatar.png' });
		expect(h).toBeInstanceOf(SectionBuilder);
		const json = h.toJSON() as {
			type: number;
			components: Array<{ content: string }>;
			accessory: { type: number; media: { url: string } };
		};
		expect(json.type).toBe(ComponentType.Section);
		expect(json.components[0]?.content).toBe('### Invites');
		expect(json.accessory.type).toBe(ComponentType.Thumbnail);
		expect(json.accessory.media.url).toBe('https://cdn.discordapp.com/avatar.png');
	});
});

describe('music player', () => {
	type Json = {
		type: number;
		content?: string;
		components?: Json[];
		style?: number;
		custom_id?: string;
		options?: Array<{ value: string; description?: string; emoji?: unknown }>;
		placeholder?: string;
	};

	const card = () =>
		musicTrackCard({
			header: 'Paused',
			color: Colors.Neutral,
			title: 'Song [Live]',
			uri: 'https://example.com/watch?v=1',
			author: 'Artist',
			album: 'Album',
			requesterMention: '<@1>',
			position: '1:24',
			duration: '3:19',
			queueSize: 2,
			autoPlay: true,
			artworkUrl: 'https://example.com/art.png',
			withControls: true,
			paused: true,
		}).toJSON() as unknown as Json & { accent_color: number };

	test('musicTrackCard has no header TextDisplay or divider at the top level', () => {
		const json = card();
		const types = (json.components ?? []).map((c) => c.type);
		expect(types).toEqual([
			ComponentType.Section,
			ComponentType.Separator,
			ComponentType.ActionRow,
			ComponentType.ActionRow,
		]);
		expect((json.components?.[1] as { divider?: boolean } | undefined)?.divider).toBe(false);
		expect(json.accent_color).toBe(Colors.Neutral);
	});

	test('musicTrackCard section text: eyebrow, linked title, byline, one meta line', () => {
		const section = card().components?.[0];
		expect(section?.components?.[0]?.content).toBe(
			'-# Paused\n### [Song \\[Live\\]](https://example.com/watch?v=1)\nArtist · Album\n-# 1:24 / 3:19 · Requested by <@1> · 2 up next · Autoplay',
		);
	});

	test('musicTrackCard eyebrow defaults to Now playing', () => {
		const json = musicTrackCard({ color: Colors.Voice, title: 'X' }).toJSON() as unknown as Json;
		expect(json.components?.[0]?.content?.split('\n')[0]).toBe('-# Now playing');
	});

	test('stop is Secondary, play/pause Primary', () => {
		const row = card().components?.[2];
		const stop = row?.components?.find((b) => b.custom_id === 'music:stop');
		const toggle = row?.components?.find((b) => b.custom_id === 'music:toggle');
		expect(stop?.style).toBe(2);
		expect(toggle?.style).toBe(1);
	});

	test('musicControlRows option values are unchanged', () => {
		const [, row2] = musicControlRows();
		const select = (row2.toJSON() as unknown as Json).components?.[0];
		expect(select?.custom_id).toBe('music:options');
		expect(select?.placeholder).toBe('More options');
		expect(select?.options?.map((o) => o.value)).toEqual([
			'queue',
			'shuffle',
			'autoplay',
			'clear_queue',
			'volume_modal',
			'filter_bassboost',
			'filter_nightcore',
			'filter_vaporwave',
			'filter_clear',
		]);
		for (const o of select?.options ?? []) {
			expect(o.description).toBeTruthy();
			expect(o.emoji).toBeTruthy();
		}
	});

	test('trackLink escapes brackets and truncates long titles', () => {
		expect(trackLink('a]b', 'https://x.test/(1)')).toBe('[a\\]b](https://x.test/%281%29)');
		expect(trackLink('t', 'not a url')).toBe('t');
		expect(trackLink('x'.repeat(100), null).length).toBe(80);
	});

	test('byline escapes line-leading markdown markers', () => {
		expect(escapeLineStart('# x')).toBe('\\# x');
		expect(escapeLineStart('- x')).toBe('\\- x');
		expect(escapeLineStart('> x')).toBe('\\> x');
		expect(escapeLineStart('1. x')).toBe('1\\. x');
		expect(escapeLineStart('Artist')).toBe('Artist');
		const json = musicTrackCard({ color: Colors.Voice, title: 'T', author: '# Big' }).toJSON() as unknown as {
			components: Array<{ content?: string }>;
		};
		expect(json.components[0]?.content?.split('\n')[2]).toBe('\\# Big');
	});
});
