import type { Subcommand } from '@sapphire/plugin-subcommands';
import { MessageFlags, TextDisplayBuilder } from 'discord.js';
import { and, eq } from 'drizzle-orm';
import {
	Colors,
	CV2_FLAG,
	errorReply,
	loadingReply,
	makeContainer,
	separator,
	successReply,
} from '../../../lib/components.js';
import { db, schema } from '../../../lib/database.js';
import {
	normaliseRedditHandle,
	resolveBlueskyHandle,
	resolveTwitchUser,
	resolveYouTubeChannelId,
} from '../../../lib/FeedPoller.js';

const PLATFORM_LABELS: Record<string, string> = {
	youtube: '🔴 YouTube',
	reddit: '🟠 Reddit',
	bluesky: '🔵 Bluesky',
	twitch: '🟣 Twitch',
	tiktok: '⬛ TikTok',
};

export class FeedsHandler {
	public async runAdd(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const platform = interaction.options.getString('platform', true) as schema.SocialPlatform;
		const rawHandle = interaction.options.getString('handle', true).trim();
		const targetChannel = interaction.options.getChannel('channel') ?? interaction.channel;
		if (!targetChannel) return interaction.editReply(errorReply('Could not resolve channel.'));

		// Resolve handle → normalised storage key + display name
		let handle = rawHandle;
		let displayName = rawHandle;

		switch (platform) {
			case 'youtube': {
				await interaction.editReply(loadingReply('🔍 Resolving YouTube channel…'));
				const resolved = await resolveYouTubeChannelId(rawHandle);
				if (!resolved)
					return interaction.editReply(
						errorReply('Could not find that YouTube channel. Try using the UCxxx channel ID directly.'),
					);
				handle = resolved.channelId;
				displayName = resolved.displayName;
				break;
			}
			case 'reddit': {
				const r = normaliseRedditHandle(rawHandle);
				handle = r.displayName; // e.g. "r/minecraft" or "u/someone"
				displayName = r.displayName;
				break;
			}
			case 'bluesky': {
				await interaction.editReply(loadingReply('🔍 Resolving Bluesky handle…'));
				const resolved = await resolveBlueskyHandle(rawHandle);
				if (!resolved) return interaction.editReply(errorReply('Could not find that Bluesky account.'));
				handle = resolved.handle;
				displayName = resolved.displayName;
				break;
			}
			case 'twitch': {
				if (!process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET) {
					return interaction.editReply(
						errorReply(
							'Twitch integration is not configured. Set `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` in your environment.',
						),
					);
				}
				await interaction.editReply(loadingReply('🔍 Resolving Twitch user…'));
				const resolved = await resolveTwitchUser(rawHandle.toLowerCase());
				if (!resolved) return interaction.editReply(errorReply('Could not find that Twitch user.'));
				handle = resolved.login;
				displayName = resolved.displayName;
				break;
			}
			case 'tiktok': {
				handle = rawHandle.replace(/^@/, '').toLowerCase();
				displayName = `@${handle}`;
				break;
			}
		}

		// Check for duplicate
		const existing = await db.query.socialFeeds.findFirst({
			where: and(
				eq(schema.socialFeeds.guildId, interaction.guildId),
				eq(schema.socialFeeds.platform, platform),
				eq(schema.socialFeeds.handle, handle),
			),
		});
		if (existing) {
			return interaction.editReply(
				errorReply(`Already subscribed to **${displayName}** on ${PLATFORM_LABELS[platform]}.`),
			);
		}

		await db.insert(schema.socialFeeds).values({
			guildId: interaction.guildId,
			channelId: targetChannel.id,
			platform,
			handle,
			displayName,
			lastPostId: null, // null = initialise on first poll, no spam
		});

		return interaction.editReply(
			successReply(
				`Subscribed to **${displayName}** (${PLATFORM_LABELS[platform]}) → <#${targetChannel.id}>. First notification will appear on the next new post.`,
			),
		);
	}

	public async runRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const id = interaction.options.getInteger('id', true);

		const feed = await db.query.socialFeeds.findFirst({
			where: and(eq(schema.socialFeeds.id, id), eq(schema.socialFeeds.guildId, interaction.guildId)),
		});
		if (!feed) return interaction.editReply(errorReply(`No feed with ID **${id}** found in this server.`));

		await db.delete(schema.socialFeeds).where(eq(schema.socialFeeds.id, id));
		return interaction.editReply(
			successReply(`Removed **${feed.displayName}** (${PLATFORM_LABELS[feed.platform]}) feed.`),
		);
	}

	public async runList(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const feeds = await db.query.socialFeeds.findMany({
			where: eq(schema.socialFeeds.guildId, interaction.guildId),
			orderBy: (t, { asc }) => [asc(t.platform), asc(t.displayName)],
		});

		if (!feeds.length) {
			return interaction.editReply(errorReply('No social feed subscriptions set up. Use `/feed add` to add one.'));
		}

		const lines = feeds.map(
			(f) => `\`#${f.id}\` ${PLATFORM_LABELS[f.platform] ?? f.platform} **${f.displayName}** → <#${f.channelId}>`,
		);

		const c = makeContainer({ color: Colors.Info });
		c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### Social Feeds\n${lines.join('\n')}`));
		c.addSeparatorComponents(separator());
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`-# ${feeds.length} feed${feeds.length === 1 ? '' : 's'} • Use \`/feed remove <id>\` to unsubscribe`,
			),
		);

		return interaction.editReply({ components: [c], flags: (CV2_FLAG | MessageFlags.Ephemeral) as any });
	}
}
