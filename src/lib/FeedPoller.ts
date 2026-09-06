import type { SocialPlatform } from '../db/schema.js';

export interface FeedPost {
	id: string;
	title: string;
	url: string;
	author: string;
	thumbnail?: string;
	description?: string;
}

export interface PollResult {
	posts: FeedPost[];
	newLastId: string | null; // always write this back to DB
}

// ─── YouTube ──────────────────────────────────────────────────────────────────

/** Resolve a YouTube @handle or channel URL to a UCxxx channel ID. */
export async function resolveYouTubeChannelId(
	input: string,
): Promise<{ channelId: string; displayName: string } | null> {
	// Already a channel ID
	if (/^UC[\w-]{22}$/.test(input)) {
		const rss = await fetchYouTubeRss(input);
		const name = rss ? (extractXml(rss, 'title') ?? input) : input;
		return { channelId: input, displayName: name };
	}

	// Strip leading @
	const handle = input.startsWith('@') ? input : `@${input}`;
	const url = `https://www.youtube.com/${handle}`;

	const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null);
	if (!res?.ok) return null;
	const html = await res.text();

	// Extract channel ID from page meta
	const match = html.match(/"channelId"\s*:\s*"(UC[\w-]{22})"/) ?? html.match(/channel\/(UC[\w-]{22})/);
	if (!match) return null;
	const channelId = match[1];

	// Get display name from RSS
	const rss = await fetchYouTubeRss(channelId);
	const displayName = rss ? (extractXml(rss, 'title') ?? handle) : handle;
	return { channelId, displayName };
}

async function fetchYouTubeRss(channelId: string): Promise<string | null> {
	const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`).catch(() => null);
	if (!res?.ok) return null;
	return res.text();
}

function extractXml(xml: string, tag: string): string | null {
	const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`));
	return m ? m[1].trim() : null;
}

function parseYouTubeRss(xml: string): FeedPost[] {
	const posts: FeedPost[] = [];
	const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)];
	for (const [, entry] of entries) {
		const videoId = extractXml(entry, 'yt:videoId');
		const title = extractXml(entry, 'title');
		const authorName = extractXml(entry, 'name');
		const thumb = entry.match(/url="(https:\/\/i[^"]+ytimg[^"]+)"/)?.[1];
		if (!videoId || !title) continue;
		posts.push({
			id: videoId,
			title,
			url: `https://www.youtube.com/watch?v=${videoId}`,
			author: authorName ?? 'YouTube',
			thumbnail: thumb,
		});
	}
	return posts; // newest first
}

async function pollYouTube(channelId: string, sinceId: string | null): Promise<PollResult> {
	const xml = await fetchYouTubeRss(channelId);
	if (!xml) return { posts: [], newLastId: sinceId };

	const all = parseYouTubeRss(xml);
	if (all.length === 0) return { posts: [], newLastId: sinceId };

	const newLastId = all[0].id;
	if (!sinceId) return { posts: [], newLastId }; // first run — initialise without spamming

	const _fresh = all.filter((p) => p.id !== sinceId);
	const cutIdx = all.findIndex((p) => p.id === sinceId);
	const posts = cutIdx === -1 ? all.slice(0, 5) : all.slice(0, cutIdx);
	return { posts: posts.slice(0, 5).reverse(), newLastId };
}

// ─── Reddit ───────────────────────────────────────────────────────────────────

/** Normalise a Reddit handle: strip leading r/ or u/. Returns { type, name }. */
export function normaliseRedditHandle(input: string): {
	type: 'subreddit' | 'user';
	name: string;
	displayName: string;
} {
	if (input.toLowerCase().startsWith('u/') || input.toLowerCase().startsWith('/u/')) {
		const name = input.replace(/^\/?u\//i, '');
		return { type: 'user', name, displayName: `u/${name}` };
	}
	const name = input.replace(/^\/?r\//i, '');
	return { type: 'subreddit', name, displayName: `r/${name}` };
}

async function pollReddit(handle: string, sinceId: string | null): Promise<PollResult> {
	const isUser = handle.startsWith('u/');
	const name = handle.replace(/^[ru]\//, '');
	const apiUrl = isUser
		? `https://www.reddit.com/user/${name}/submitted.json?limit=10&raw_json=1`
		: `https://www.reddit.com/r/${name}/new.json?limit=10&raw_json=1`;

	const res = await fetch(apiUrl, { headers: { 'User-Agent': 'Erica-Bot/1.0' } }).catch(() => null);
	if (!res?.ok) return { posts: [], newLastId: sinceId };

	const json = (await res.json().catch(() => null)) as {
		data: {
			children: Array<{
				data: {
					id: string;
					name: string;
					title: string;
					url: string;
					author: string;
					thumbnail?: string;
					selftext?: string;
					permalink: string;
				};
			}>;
		};
	} | null;
	if (!json?.data?.children?.length) return { posts: [], newLastId: sinceId };

	const items = json.data.children.map((c) => c.data);
	const newLastId = items[0].name; // full name like t3_xxxxx

	if (!sinceId) return { posts: [], newLastId };

	const cutIdx = items.findIndex((p) => p.name === sinceId);
	const fresh = cutIdx === -1 ? items.slice(0, 5) : items.slice(0, cutIdx);

	const posts = fresh
		.slice(0, 5)
		.reverse()
		.map((p) => ({
			id: p.name,
			title: p.title,
			url: `https://www.reddit.com${p.permalink}`,
			author: `u/${p.author}`,
			thumbnail: p.thumbnail && p.thumbnail.startsWith('http') ? p.thumbnail : undefined,
			description: p.selftext ? p.selftext.slice(0, 200) : undefined,
		}));

	return { posts, newLastId };
}

// ─── Bluesky ──────────────────────────────────────────────────────────────────

export async function resolveBlueskyHandle(input: string): Promise<{ handle: string; displayName: string } | null> {
	const handle = input.startsWith('@') ? input.slice(1) : input;
	const res = await fetch(
		`https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`,
	).catch(() => null);
	if (!res?.ok) return null;
	const json = (await res.json().catch(() => null)) as { did?: string } | null;
	if (!json?.did) return null;

	// Get display name
	const profileRes = await fetch(
		`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(handle)}`,
	).catch(() => null);
	const profile = profileRes?.ok
		? ((await profileRes.json().catch(() => null)) as { displayName?: string } | null)
		: null;

	return { handle, displayName: profile?.displayName ?? handle };
}

async function pollBluesky(handle: string, sinceId: string | null): Promise<PollResult> {
	const res = await fetch(
		`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(handle)}&limit=10&filter=posts_no_replies`,
	).catch(() => null);
	if (!res?.ok) return { posts: [], newLastId: sinceId };

	const json = (await res.json().catch(() => null)) as {
		feed?: Array<{
			post: {
				cid: string;
				uri: string;
				author: { handle: string; displayName?: string };
				record: { text?: string; createdAt?: string };
				embed?: { thumbnail?: { fullsize?: string }; images?: Array<{ fullsize?: string }> };
			};
			reason?: unknown;
		}>;
	} | null;
	if (!json?.feed?.length) return { posts: [], newLastId: sinceId };

	// Skip reposts
	const items = json.feed.filter((f) => !f.reason);
	if (!items.length) return { posts: [], newLastId: sinceId };

	const newLastId = items[0].post.cid;
	if (!sinceId) return { posts: [], newLastId };

	const cutIdx = items.findIndex((f) => f.post.cid === sinceId);
	const fresh = cutIdx === -1 ? items.slice(0, 5) : items.slice(0, cutIdx);

	const posts = fresh
		.slice(0, 5)
		.reverse()
		.map((f) => {
			const { post } = f;
			const rkey = post.uri.split('/').pop() ?? '';
			const url = `https://bsky.app/profile/${post.author.handle}/post/${rkey}`;
			const thumb =
				(post.embed as { thumbnail?: { fullsize?: string }; images?: Array<{ fullsize?: string }> } | undefined)
					?.images?.[0]?.fullsize ??
				(post.embed as { thumbnail?: { fullsize?: string } } | undefined)?.thumbnail?.fullsize;

			return {
				id: post.cid,
				title: post.record.text?.slice(0, 100) ?? '(no text)',
				url,
				author: post.author.displayName ?? post.author.handle,
				thumbnail: thumb,
				description: post.record.text,
			};
		});

	return { posts, newLastId };
}

// ─── Twitch ───────────────────────────────────────────────────────────────────

let twitchToken: string | null = null;
let twitchTokenExpiry = 0;

async function getTwitchToken(): Promise<string | null> {
	const clientId = process.env.TWITCH_CLIENT_ID;
	const clientSecret = process.env.TWITCH_CLIENT_SECRET;
	if (!clientId || !clientSecret) return null;

	if (twitchToken && Date.now() < twitchTokenExpiry) return twitchToken;

	const res = await fetch(
		`https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
		{ method: 'POST' },
	).catch(() => null);
	if (!res?.ok) return null;

	const json = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
	if (!json?.access_token) return null;

	twitchToken = json.access_token;
	twitchTokenExpiry = Date.now() + (json.expires_in ?? 3600) * 1000 - 60_000;
	return twitchToken;
}

export async function resolveTwitchUser(username: string): Promise<{ login: string; displayName: string } | null> {
	const token = await getTwitchToken();
	if (!token) return null;
	const clientId = process.env.TWITCH_CLIENT_ID!;

	const res = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(username)}`, {
		headers: { Authorization: `Bearer ${token}`, 'Client-Id': clientId },
	}).catch(() => null);
	if (!res?.ok) return null;

	const json = (await res.json().catch(() => null)) as { data?: Array<{ login: string; display_name: string }> } | null;
	const user = json?.data?.[0];
	if (!user) return null;
	return { login: user.login, displayName: user.display_name };
}

async function pollTwitch(login: string, sinceId: string | null): Promise<PollResult> {
	const token = await getTwitchToken();
	if (!token) return { posts: [], newLastId: sinceId };
	const clientId = process.env.TWITCH_CLIENT_ID!;

	const res = await fetch(`https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(login)}`, {
		headers: { Authorization: `Bearer ${token}`, 'Client-Id': clientId },
	}).catch(() => null);
	if (!res?.ok) return { posts: [], newLastId: sinceId };

	const json = (await res.json().catch(() => null)) as {
		data?: Array<{ id: string; user_name: string; title: string; thumbnail_url: string; viewer_count: number }>;
	} | null;

	const stream = json?.data?.[0];

	if (!stream) {
		// Offline — clear so next live triggers a notification
		return { posts: [], newLastId: null };
	}

	if (stream.id === sinceId) {
		// Already notified about this stream
		return { posts: [], newLastId: sinceId };
	}

	const thumb = stream.thumbnail_url.replace('{width}', '1280').replace('{height}', '720');
	return {
		posts: [
			{
				id: stream.id,
				title: stream.title || `${stream.user_name} is live!`,
				url: `https://www.twitch.tv/${login}`,
				author: stream.user_name,
				thumbnail: thumb,
				description: `👥 ${stream.viewer_count.toLocaleString()} viewers`,
			},
		],
		newLastId: stream.id,
	};
}

// ─── TikTok ───────────────────────────────────────────────────────────────────

async function pollTikTok(username: string, sinceId: string | null): Promise<PollResult> {
	const res = await fetch(`https://www.tiktok.com/@${username}`, {
		headers: {
			'User-Agent':
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
			Accept: 'text/html',
		},
	}).catch(() => null);
	if (!res?.ok) return { posts: [], newLastId: sinceId };

	const html = await res.text().catch(() => '');

	// Extract video IDs from page HTML
	const videoIds = [...html.matchAll(/\/video\/(\d{15,20})/g)].map((m) => m[1]);
	const unique = [...new Set(videoIds)];
	if (!unique.length) return { posts: [], newLastId: sinceId };

	const newLastId = unique[0];
	if (!sinceId) return { posts: [], newLastId };
	if (newLastId === sinceId) return { posts: [], newLastId };

	const cutIdx = unique.indexOf(sinceId);
	const fresh = cutIdx === -1 ? unique.slice(0, 5) : unique.slice(0, cutIdx);

	const posts = fresh
		.slice(0, 5)
		.reverse()
		.map((id) => ({
			id,
			title: `New TikTok from @${username}`,
			url: `https://www.tiktok.com/@${username}/video/${id}`,
			author: `@${username}`,
		}));

	return { posts, newLastId };
}

// ─── RSS / Atom ───────────────────────────────────────────────────────────────

/** Fetch an RSS or Atom feed and return its title. Returns null if unreachable or not a valid feed. */
export async function resolveRssFeed(url: string): Promise<{ url: string; displayName: string } | null> {
	const res = await fetch(url, { headers: { 'User-Agent': 'Erica-Bot/1.0' } }).catch(() => null);
	if (!res?.ok) return null;
	const xml = await res.text().catch(() => null);
	if (!xml) return null;
	// Must look like a feed
	if (!/<(rss|feed|channel)\b/i.test(xml)) return null;
	const title = extractXml(xml, 'title') ?? new URL(url).hostname;
	return { url, displayName: title };
}

async function pollRss(feedUrl: string, sinceId: string | null): Promise<PollResult> {
	const res = await fetch(feedUrl, { headers: { 'User-Agent': 'Erica-Bot/1.0' } }).catch(() => null);
	if (!res?.ok) return { posts: [], newLastId: sinceId };
	const xml = await res.text().catch(() => '');

	const posts: FeedPost[] = [];

	// Try RSS <item> entries first, then Atom <entry>
	const itemMatches = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
	const entryMatches = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)];
	const blocks = itemMatches.length > 0 ? itemMatches : entryMatches;

	for (const [, block] of blocks.slice(0, 10)) {
		// RSS: <guid>, Atom: <id>
		const id = extractXml(block, 'guid') ?? extractXml(block, 'id');
		// RSS: <link>, Atom: <link href="..."> or <link>
		const link = block.match(/<link href="([^"]+)"/)?.[1] ?? extractXml(block, 'link') ?? '';
		const title = extractXml(block, 'title') ?? 'New post';
		const description = extractXml(block, 'description') ?? extractXml(block, 'summary');
		const author =
			extractXml(block, 'author') ?? block.match(/<name>([^<]+)<\/name>/)?.[1] ?? new URL(feedUrl).hostname;

		if (!id && !link) continue;
		posts.push({ id: id ?? link, title, url: link, author, description: description?.slice(0, 200) });
	}

	if (posts.length === 0) return { posts: [], newLastId: sinceId };

	const newLastId = posts[0].id;
	if (!sinceId) return { posts: [], newLastId };

	const cutIdx = posts.findIndex((p) => p.id === sinceId);
	const fresh = cutIdx === -1 ? posts.slice(0, 5) : posts.slice(0, cutIdx);
	return { posts: fresh.slice(0, 5).reverse(), newLastId };
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

export async function pollFeed(platform: SocialPlatform, handle: string, sinceId: string | null): Promise<PollResult> {
	switch (platform) {
		case 'youtube':
			return pollYouTube(handle, sinceId);
		case 'reddit':
			return pollReddit(handle, sinceId);
		case 'bluesky':
			return pollBluesky(handle, sinceId);
		case 'twitch':
			return pollTwitch(handle, sinceId);
		case 'tiktok':
			return pollTikTok(handle, sinceId);
		case 'rss':
			return pollRss(handle, sinceId);
	}
}
