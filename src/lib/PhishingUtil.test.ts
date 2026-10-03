import { describe, expect, test } from 'bun:test';
import { USER_AGENT } from './brand.js';
import {
	extractUrlHosts,
	findPhishingDomain,
	getPhishingDomains,
	getPhishingListState,
	normalizeHost,
	parsePhishingList,
	refreshPhishingList,
} from './PhishingUtil.js';

const LIST = new Set(['scam.com', 'discord-gift.xyz', '0pensea-gifts-013.vercel.app']);

describe('extractUrlHosts', () => {
	test('extracts hosts from http and https URLs', () => {
		expect(extractUrlHosts('see https://example.com/a and http://other.org?x=1')).toEqual(['example.com', 'other.org']);
	});

	test('lowercases uppercase hosts', () => {
		expect(extractUrlHosts('HTTPS://EXAMPLE.COM/Path')).toEqual(['example.com']);
	});

	test('strips www. and trailing dots', () => {
		expect(extractUrlHosts('https://www.example.com/ and https://example.org./x')).toEqual([
			'example.com',
			'example.org',
		]);
	});

	test('drops ports, paths, queries and fragments', () => {
		expect(extractUrlHosts('https://example.com:8080/a?b=c#d')).toEqual(['example.com']);
	});

	test('takes the host after userinfo, not the decoy before the @', () => {
		expect(extractUrlHosts('https://discord.com@evil.example/login')).toEqual(['evil.example']);
	});

	test('extracts the target of masked markdown links', () => {
		expect(extractUrlHosts('[free nitro](https://scam.com/claim) and <https://www.other.net>')).toEqual([
			'scam.com',
			'other.net',
		]);
	});

	test('finds scheme-less domains but ignores path segments and emails', () => {
		expect(extractUrlHosts('go to discord-gift.xyz/claim now')).toEqual(['discord-gift.xyz']);
		expect(extractUrlHosts('https://safe.com/page.html and mail me at bob@mail.example.com')).toEqual(['safe.com']);
	});

	test('deduplicates hosts', () => {
		expect(extractUrlHosts('https://a.com https://A.com a.com')).toEqual(['a.com']);
	});

	test('returns an empty array without links', () => {
		expect(extractUrlHosts('')).toEqual([]);
		expect(extractUrlHosts('no links here, version 1.2.3 and a sentence.')).toEqual([]);
	});

	test('an emoji glued to a domain does not hide it', () => {
		expect(extractUrlHosts('🎁scam.com')).toEqual(['scam.com']);
	});

	test('converts internationalised hosts to punycode', () => {
		expect(extractUrlHosts('https://bücher.example/')).toEqual(['xn--bcher-kva.example']);
	});
});

describe('normalizeHost', () => {
	test('normalises case, www and trailing dot', () => {
		expect(normalizeHost('WWW.Example.COM.')).toBe('example.com');
	});

	test('rejects single labels, wildcards and empty input', () => {
		expect(normalizeHost('localhost')).toBeNull();
		expect(normalizeHost('clk.rtpdn*.com')).toBeNull();
		expect(normalizeHost('')).toBeNull();
	});
});

describe('findPhishingDomain', () => {
	test('matches a listed domain', () => {
		expect(findPhishingDomain('free nitro https://scam.com/x', LIST)).toBe('scam.com');
	});

	test('matches a subdomain of a listed domain and reports the listed domain', () => {
		expect(findPhishingDomain('https://login.verify.scam.com/', LIST)).toBe('scam.com');
	});

	test('matches with www. and uppercase', () => {
		expect(findPhishingDomain('HTTPS://WWW.SCAM.COM/', LIST)).toBe('scam.com');
	});

	test('matches a listed subdomain exactly', () => {
		expect(findPhishingDomain('https://0pensea-gifts-013.vercel.app', LIST)).toBe('0pensea-gifts-013.vercel.app');
		expect(findPhishingDomain('https://other.vercel.app', LIST)).toBeNull();
	});

	test('matches a masked markdown link and a scheme-less domain', () => {
		expect(findPhishingDomain('[steam gift](https://scam.com/gift)', LIST)).toBe('scam.com');
		expect(findPhishingDomain('claim at discord-gift.xyz today', LIST)).toBe('discord-gift.xyz');
	});

	test('does not match non-listed hosts, lookalike suffixes or decoy text', () => {
		expect(findPhishingDomain('https://example.com and https://notscam.com', LIST)).toBeNull();
		expect(findPhishingDomain('https://scam.com.example.org/', LIST)).toBeNull();
		expect(findPhishingDomain('https://example.com/scam.com', LIST)).toBeNull();
		expect(findPhishingDomain('plain text', LIST)).toBeNull();
	});

	test('never fires with an empty list', () => {
		expect(findPhishingDomain('https://scam.com', new Set())).toBeNull();
	});

	test('whitelist exempts the host and its subdomains', () => {
		expect(findPhishingDomain('https://scam.com/x', LIST, ['scam.com'])).toBeNull();
		expect(findPhishingDomain('https://sub.scam.com/x', LIST, ['scam.com'])).toBeNull();
		expect(findPhishingDomain('https://www.scam.com/x', LIST, ['Scam.COM'])).toBeNull();
		expect(findPhishingDomain('https://scam.com/x', LIST, ['https://scam.com/'])).toBeNull();
	});

	test('a whitelisted subdomain does not exempt its siblings', () => {
		expect(findPhishingDomain('https://ok.scam.com/', LIST, ['ok.scam.com'])).toBeNull();
		expect(findPhishingDomain('https://bad.scam.com/', LIST, ['ok.scam.com'])).toBe('scam.com');
	});

	test('an unrelated whitelist entry changes nothing', () => {
		expect(findPhishingDomain('https://scam.com/x', LIST, ['youtube.com'])).toBe('scam.com');
	});

	test('a whitelisted link does not hide another scam link in the same message', () => {
		expect(findPhishingDomain('https://youtube.com/a and https://scam.com/b', LIST, ['youtube.com'])).toBe('scam.com');
	});
});

describe('parsePhishingList', () => {
	test('parses a JSON array, normalising and dropping junk', () => {
		const set = parsePhishingList(
			JSON.stringify([
				'scam.com',
				'WWW.Other.NET',
				'clk.rtpdn*.com',
				'discorte-nitro',
				'captcha-lookup.xyz?path=v',
				42,
			]),
		);
		expect([...set].sort()).toEqual(['captcha-lookup.xyz', 'other.net', 'scam.com']);
	});

	test('parses newline-separated text with blank lines and comments', () => {
		const set = parsePhishingList('# header\nscam.com\r\n\nhttps://www.Other.net/path\n');
		expect([...set].sort()).toEqual(['other.net', 'scam.com']);
	});

	test('throws on malformed JSON and non-array JSON', () => {
		expect(() => parsePhishingList('["scam.com"')).toThrow();
		expect(() => parsePhishingList('{"a":1}')).toThrow();
	});
});

describe('refreshPhishingList', () => {
	const ok = (body: string) => async () => new Response(body, { status: 200 });

	test('loads the list and records size and time', async () => {
		const before = Date.now();
		const result = await refreshPhishingList({ fetchImpl: ok(JSON.stringify(['scam.com', 'evil.net'])) });
		expect(result).toEqual({ ok: true, size: 2 });
		expect(getPhishingDomains().has('scam.com')).toBe(true);
		const state = getPhishingListState();
		expect(state.size).toBe(2);
		expect(state.refreshedAt).toBeGreaterThanOrEqual(before);
	});

	test('sends the bot User-Agent', async () => {
		let seen: RequestInit | undefined;
		await refreshPhishingList({
			fetchImpl: async (_url, init) => {
				seen = init;
				return new Response('["scam.com"]');
			},
		});
		const headers = (seen?.headers ?? {}) as Record<string, string>;
		expect(headers['User-Agent']).toBe(USER_AGENT);
	});

	test('a failed refresh keeps the previous list', async () => {
		await refreshPhishingList({ fetchImpl: ok('["scam.com","evil.net"]') });
		const loadedAt = getPhishingListState().refreshedAt;

		const http = await refreshPhishingList({ fetchImpl: async () => new Response('nope', { status: 503 }) });
		expect(http.ok).toBe(false);
		const network = await refreshPhishingList({
			fetchImpl: async () => {
				throw new Error('network down');
			},
		});
		expect(network).toEqual({ ok: false, error: 'network down' });
		const garbage = await refreshPhishingList({ fetchImpl: ok('["scam.com"') });
		expect(garbage.ok).toBe(false);
		const empty = await refreshPhishingList({ fetchImpl: ok('[]') });
		expect(empty.ok).toBe(false);

		expect(getPhishingDomains().size).toBe(2);
		expect(getPhishingDomains().has('evil.net')).toBe(true);
		expect(getPhishingListState().refreshedAt).toBe(loadedAt);
	});

	test('a successful refresh replaces the list', async () => {
		await refreshPhishingList({ fetchImpl: ok('["new.example"]') });
		expect([...getPhishingDomains()]).toEqual(['new.example']);
	});
});
