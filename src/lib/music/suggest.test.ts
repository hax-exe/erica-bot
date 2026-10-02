import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { _resetSuggestCache, searchSuggestions } from './suggest.js';

const realFetch = globalThis.fetch;
let calls = 0;

function mockFetch(impl: () => Promise<Response>) {
	calls = 0;
	globalThis.fetch = (async () => {
		calls++;
		return impl();
	}) as unknown as typeof fetch;
}

beforeEach(() => _resetSuggestCache());
afterEach(() => {
	globalThis.fetch = realFetch;
});

describe('searchSuggestions', () => {
	test('maps Deezer results', async () => {
		mockFetch(async () =>
			Response.json({ data: [{ title: 'Song', duration: 180, artist: { name: 'Band' } }, { title: 'bad' }] }),
		);
		expect(await searchSuggestions('song')).toEqual([{ title: 'Song', artist: 'Band', durationMs: 180_000 }]);
	});

	test('serves repeated queries from cache', async () => {
		mockFetch(async () => Response.json({ data: [{ title: 'A', duration: 1, artist: { name: 'B' } }] }));
		await searchSuggestions('Query');
		await searchSuggestions('query');
		expect(calls).toBe(1);
	});

	test('returns [] on failure', async () => {
		mockFetch(async () => {
			throw new Error('timeout');
		});
		expect(await searchSuggestions('x1')).toEqual([]);
		mockFetch(async () => new Response('no', { status: 500 }));
		expect(await searchSuggestions('x2')).toEqual([]);
	});
});
