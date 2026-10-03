import { describe, expect, test } from 'bun:test';
import { ComponentType, SectionBuilder, TextDisplayBuilder } from 'discord.js';
import { BRAND_COLOR } from './brand.js';
import { Colors, chips, errorReply, fields, formatStatus, headerSection, hint, spacer } from './components.js';

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
