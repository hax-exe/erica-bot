import { ApplyOptions } from '@sapphire/decorators';
import { container, Listener } from '@sapphire/framework';
import { type Client, Events, TextDisplayBuilder } from 'discord.js';
import { eq } from 'drizzle-orm';
import { Colors, CV2_FLAG, makeContainer } from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';
import { type FeedPost, pollFeed } from '../../lib/FeedPoller.js';

const POLL_INTERVAL_MS = 5 * 60_000; // every 5 minutes
let pollRunning = false;

const PLATFORM_EMOJI: Record<string, string> = {
	youtube: '🔴',
	reddit: '🟠',
	bluesky: '🔵',
	twitch: '🟣',
	tiktok: '⬛',
	rss: '📡',
};

const PLATFORM_COLOR: Record<string, number> = {
	youtube: 0xff0000,
	reddit: 0xff4500,
	bluesky: 0x0085ff,
	twitch: 0x9146ff,
	tiktok: 0xee1d52,
	rss: 0xf26522,
};

function buildPostCard(platform: schema.SocialPlatform, displayName: string, post: FeedPost) {
	const emoji = PLATFORM_EMOJI[platform] ?? '📡';
	const color = PLATFORM_COLOR[platform] ?? Colors.Info;

	const c = makeContainer({ color });

	const headerLine =
		platform === 'twitch' ? `${emoji} **${displayName}** is now live!` : `${emoji} New post from **${displayName}**`;

	const lines: string[] = [headerLine, '', `**[${post.title}](${post.url})**`];
	if (post.description && platform !== 'youtube') {
		lines.push('', post.description.length > 200 ? `${post.description.slice(0, 200)}…` : post.description);
	}
	if (platform === 'twitch' && post.description) {
		lines.push('', post.description);
	}

	c.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
	return c;
}

async function pollFeeds(client: Client<true>): Promise<void> {
	const feeds = await db.select().from(schema.socialFeeds);

	for (const feed of feeds) {
		try {
			const { posts, newLastId } = await pollFeed(feed.platform, feed.handle, feed.lastPostId);

			if (!posts.length) {
				if (newLastId !== feed.lastPostId) {
					await db.update(schema.socialFeeds).set({ lastPostId: newLastId }).where(eq(schema.socialFeeds.id, feed.id));
				}
				continue;
			}

			const ch =
				client.channels.cache.get(feed.channelId) ?? (await client.channels.fetch(feed.channelId).catch(() => null));
			if (!ch?.isSendable()) continue;

			let delivered = true;
			for (const post of posts) {
				const card = buildPostCard(feed.platform, feed.displayName, post);
				const sent = await (ch.send as (opts: unknown) => Promise<unknown>)({
					components: [card],
					flags: CV2_FLAG,
				}).catch(() => null);
				if (!sent) {
					delivered = false;
					break;
				}
				// Small delay between posts to avoid rate limits
				await new Promise((r) => setTimeout(r, 1000));
			}
			if (delivered && newLastId !== feed.lastPostId) {
				await db.update(schema.socialFeeds).set({ lastPostId: newLastId }).where(eq(schema.socialFeeds.id, feed.id));
			}
		} catch (err) {
			container.logger.error(`[FeedScheduler] Error polling ${feed.platform}/${feed.handle}:`, err);
		}
	}
}

async function runPoll(client: Client<true>): Promise<void> {
	if (pollRunning) return;
	pollRunning = true;
	try {
		await pollFeeds(client);
	} finally {
		pollRunning = false;
	}
}

@ApplyOptions<Listener.Options>({
	name: 'feedScheduler',
	event: Events.ClientReady,
	once: true,
})
export class FeedSchedulerListener extends Listener<typeof Events.ClientReady> {
	public override async run(client: Client<true>) {
		// Initial poll after 30s to let the bot fully settle
		setTimeout(() => {
			runPoll(client).catch((err) => container.logger.error('[FeedScheduler] initial poll failed:', err));
		}, 30_000);

		setInterval(() => {
			runPoll(client).catch((err) => container.logger.error('[FeedScheduler] poll failed:', err));
		}, POLL_INTERVAL_MS);
	}
}
