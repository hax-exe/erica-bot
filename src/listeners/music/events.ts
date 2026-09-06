import { ApplyOptions } from '@sapphire/decorators';
import { container, Listener } from '@sapphire/framework';
import { Events, type Message, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder } from 'discord.js';
import { eq } from 'drizzle-orm';
import type { Player, Track } from 'moonlink.js';
import { ensureAutoplayBuffer, isAutoplayOn, rememberAutoplaySeed } from '../../lib/AutoplayManager.js';
import { Colors, CV2_FLAG, idleJukeboxCard, makeContainer, musicTrackCard, separator } from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';
import { clearMusicQueue, formatDuration, saveMusicQueue, setVoiceChannelStatus } from '../../lib/MusicManager.js';

// Tracks the active "Now Playing" message per guild so we can delete it when done
export const npMessages = new Map<string, Message>();

export function clearNpMessage(guildId: string): void {
	const msg = npMessages.get(guildId);
	if (!msg) return;
	npMessages.delete(guildId);
	void msg.delete().catch(() => null);
}

/** Resolve a text channel by ID, fetching from API if not in cache. */
async function getChannel(id: string | null | undefined) {
	if (!id) return null;
	const cached = container.client.channels.cache.get(id);
	if (cached) return cached.isSendable() ? cached : null;
	const fetched = await container.client.channels.fetch(id).catch(() => null);
	return fetched?.isSendable() ? fetched : null;
}

export async function resetJukeboxUI(guildId: string): Promise<void> {
	try {
		const guildRow = await db.query.guilds.findFirst({ where: eq(schema.guilds.id, guildId) });
		if (!guildRow?.musicChannelId || !guildRow.musicMessageId) return;
		const musicChannel = await getChannel(guildRow.musicChannelId);
		if (!musicChannel?.isTextBased()) return;
		const uiMessage = await musicChannel.messages.fetch(guildRow.musicMessageId).catch(() => null);
		if (uiMessage) {
			await uiMessage.edit({ components: [idleJukeboxCard()], flags: CV2_FLAG as any }).catch(() => null);
		}
	} catch {
		// UI cleanup is non-critical.
	}
}

/** Update the Jukebox UI, active Now Playing message, and Voice Channel status for the guild player. */
export async function updatePlaybackState(player: Player) {
	const client = container.client;
	const track = player.current;

	// 1. Update Voice Channel Status
	if (player.voiceChannelId) {
		if (track) {
			const status = player.paused
				? `Paused — ${track.title}`
				: track.author
					? `${track.title} — ${track.author}`
					: (track.title ?? '');
			await setVoiceChannelStatus(client, player.voiceChannelId, status);
		} else {
			await setVoiceChannelStatus(client, player.voiceChannelId, null);
		}
	}

	// 2. Build Card
	const card = buildNpCard(player);
	if (!card) return;

	// 3. Update Jukebox UI
	const guildRow = await db.query.guilds.findFirst({ where: eq(schema.guilds.id, player.guildId) }).catch(() => null);
	if (guildRow?.musicChannelId && guildRow?.musicMessageId) {
		const musicChannel = await getChannel(guildRow.musicChannelId);
		if (musicChannel && musicChannel.isTextBased()) {
			const uiMessage = await musicChannel.messages.fetch(guildRow.musicMessageId).catch(() => null);
			if (uiMessage) {
				await uiMessage.edit({ components: [card], flags: CV2_FLAG as any }).catch(() => null);
			}
		}
	}

	// 4. Update Chat Now Playing Card (if not dedicated music channel)
	if (player.textChannelId !== guildRow?.musicChannelId) {
		const msg = npMessages.get(player.guildId);
		if (msg) {
			await msg.edit({ components: [card], flags: CV2_FLAG as any }).catch(() => null);
		}
	}
}

export function buildNpCard(player: Player) {
	const track = player.current;
	if (!track) return null;

	const requesterUserId = track.userData?.requester as string | undefined;
	const requesterMention = requesterUserId ? `<@${requesterUserId}>` : undefined;
	const duration = track.isStream ? 'LIVE' : formatDuration(track.duration ?? 0);
	const position = !track.isStream && track.duration != null ? formatDuration(track.position ?? 0) : null;
	const queueSize = player.queue.size;
	const album = (track.pluginInfo as Record<string, unknown> | undefined)?.albumName as string | undefined;
	const loopMode = (player.loop as 'off' | 'track' | 'queue') ?? 'off';

	let header = 'Now Playing';
	let color: number = Colors.Voice;
	if (player.paused) {
		header = 'Paused';
		color = Colors.Warning;
	}

	return musicTrackCard({
		header,
		color,
		title: track.title ?? 'Unknown',
		uri: track.uri,
		author: track.author,
		album,
		artworkUrl: track.artworkUrl,
		requesterMention,
		position,
		duration,
		autoPlay: isAutoplayOn(player.guildId),
		queueSize,
		withControls: true,
		paused: player.paused,
		loopMode,
	});
}

@ApplyOptions<Listener.Options>({ name: 'musicListeners', event: Events.ClientReady, once: true })
export class MusicListeners extends Listener {
	public override run() {
		const { music, logger, client } = this.container;

		// ── Disconnect / kick handling ───────────────────────────────────────────
		// Moonlink starts a 10-second reconnect timer whenever the bot loses its
		// voice connection. We intercept that by destroying the player the moment
		// Discord reports the bot was removed from the channel (kicked, moved out,
		// or channel deleted). A voluntary disconnect via player.destroy() removes
		// the player from music.players first, so the guard below is a no-op then.

		client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
			if (newState.id !== client.user!.id) return;
			if (!oldState.channelId || newState.channelId) return; // not a removal

			const player = music.players.get(oldState.guild.id);
			if (!player) return;

			const textChannelId = player.textChannelId;
			clearNpMessage(oldState.guild.id);
			await clearMusicQueue(player.guildId);
			await setVoiceChannelStatus(client, oldState.channelId, null).catch(() => null);
			await player.destroy().catch(() => null);
			await resetJukeboxUI(oldState.guild.id);

			const ch = await getChannel(textChannelId);
			if (!ch) return;

			const c = makeContainer({ color: Colors.Neutral });
			c.addTextDisplayComponents(new TextDisplayBuilder().setContent('Disconnected from voice — queue cleared.'));
			await (ch.send as (opts: unknown) => Promise<unknown>)({ components: [c], flags: CV2_FLAG }).catch(() => null);
		});

		// ── Node events ──────────────────────────────────────────────────────────

		music.on('nodeReady', (node) => {
			logger.info(`[music] Node "${node.identifier}" connected and ready.`);
		});

		music.on('nodeError', (node, error) => {
			logger.error(`[music] Node "${node.identifier}" error:`, error);
		});

		music.on('nodeDisconnect', (node, code, reason) => {
			logger.warn(`[music] Node "${node.identifier}" disconnected (${code}): ${reason}`);
		});

		// Periodically save position/state of active players and update Jukebox UI progress bar
		setInterval(async () => {
			for (const player of music.players.all) {
				if (player.playing && !player.paused) {
					await saveMusicQueue(player).catch(() => null);

					// Update Jukebox message if it exists
					const guildRow = await db.query.guilds
						.findFirst({ where: eq(schema.guilds.id, player.guildId) })
						.catch(() => null);
					if (guildRow?.musicChannelId && guildRow?.musicMessageId) {
						const musicChannel = await getChannel(guildRow.musicChannelId).catch(() => null);
						if (musicChannel && musicChannel.isTextBased()) {
							const uiMessage = await musicChannel.messages.fetch(guildRow.musicMessageId).catch(() => null);
							if (uiMessage) {
								const card = buildNpCard(player);
								if (card) {
									await uiMessage.edit({ components: [card], flags: CV2_FLAG as any }).catch(() => null);
								}
							}
						}
					}
				}
			}
		}, 10_000);

		// ── Track events ─────────────────────────────────────────────────────────

		music.on('trackStart', async (player: Player, track: Track) => {
			if (track.userData?.isTTS) {
				// Silently play TTS without posting a now playing card or updating voice channel status
				return;
			}

			rememberAutoplaySeed(track, player.guildId);

			// Keep autoplay buffer topped up so skip never drains to idle
			if (isAutoplayOn(player.guildId) && player.queue.size < 3) {
				void ensureAutoplayBuffer(player, track).catch((err) =>
					logger.warn(`[autoplay] buffer refill failed for ${player.guildId}:`, err),
				);
			}

			// Resume from position if it was interrupted
			if (track.userData?.resumePosition) {
				const resumePos = track.userData.resumePosition;
				delete track.userData.resumePosition;
				player.seek(resumePos).catch(() => null);
			}

			if (player.voiceChannelId) {
				const status = track.author ? `${track.title} — ${track.author}` : (track.title ?? '');
				await setVoiceChannelStatus(client, player.voiceChannelId, status);
			}

			const ch = await getChannel(player.textChannelId);
			if (!ch) return;

			const card = buildNpCard(player);
			if (!card) return;

			const guildRow = await db.query.guilds.findFirst({ where: eq(schema.guilds.id, player.guildId) });
			if (guildRow?.musicChannelId && guildRow?.musicMessageId) {
				const musicChannel = await getChannel(guildRow.musicChannelId);
				if (musicChannel && musicChannel.isTextBased()) {
					const uiMessage = await musicChannel.messages.fetch(guildRow.musicMessageId).catch(() => null);
					if (uiMessage) {
						await uiMessage.edit({ components: [card], flags: CV2_FLAG as any }).catch(() => null);
					}
				}
			}

			// One Now Playing message — edit in place on track change; never stack duplicates
			if (player.textChannelId !== guildRow?.musicChannelId) {
				const existing = npMessages.get(player.guildId);
				if (existing) {
					const edited = await existing.edit({ components: [card], flags: CV2_FLAG as any }).catch(() => null);
					if (edited) {
						npMessages.set(player.guildId, edited);
					} else {
						npMessages.delete(player.guildId);
						const sent = await (ch.send as (opts: unknown) => Promise<Message>)({
							components: [card],
							flags: CV2_FLAG,
						}).catch(() => null);
						if (sent) npMessages.set(player.guildId, sent);
					}
				} else {
					const sent = await (ch.send as (opts: unknown) => Promise<Message>)({
						components: [card],
						flags: CV2_FLAG,
					}).catch(() => null);
					if (sent) npMessages.set(player.guildId, sent);
				}
			}

			await saveMusicQueue(player);
		});

		music.on('queueEnd', async (player: Player, lastTrack?: Track) => {
			if (lastTrack?.userData?.isTTS) {
				clearNpMessage(player.guildId);
				await clearMusicQueue(player.guildId);
				if (player.voiceChannelId) await setVoiceChannelStatus(client, player.voiceChannelId, null);
				return;
			}

			// Erica-owned autoplay — refill buffer (Moonlink native autoPlay is always off).
			if (isAutoplayOn(player.guildId)) {
				const filled = await ensureAutoplayBuffer(player, lastTrack ?? null).catch((err) => {
					logger.warn(`[autoplay] enqueue failed for guild ${player.guildId}:`, err);
					return 0;
				});
				if (filled > 0 || player.playing || player.current) return;
			}

			clearNpMessage(player.guildId);
			await clearMusicQueue(player.guildId);
			if (player.voiceChannelId) await setVoiceChannelStatus(client, player.voiceChannelId, null);
			await resetJukeboxUI(player.guildId);

			const ch = await getChannel(player.textChannelId);
			if (!ch) return;

			const c = makeContainer({ color: Colors.Neutral });
			c.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					isAutoplayOn(player.guildId)
						? 'Autoplay couldn’t find another track. Add more with `/play`.'
						: 'Queue finished. Add more tracks with `/play` or enable autoplay with the button below.',
				),
			);
			c.addSeparatorComponents(separator());
			await (ch.send as (opts: unknown) => Promise<unknown>)({ components: [c], flags: CV2_FLAG }).catch(() => null);
		});

		music.on('autoLeaved', async (player: Player) => {
			clearNpMessage(player.guildId);
			await clearMusicQueue(player.guildId);
			if (player.voiceChannelId) await setVoiceChannelStatus(client, player.voiceChannelId, null);
			await resetJukeboxUI(player.guildId);

			const ch = await getChannel(player.textChannelId);
			if (!ch) return;

			const c = makeContainer({ color: Colors.Neutral });
			c.addTextDisplayComponents(new TextDisplayBuilder().setContent('Left the voice channel due to inactivity.'));
			c.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));

			await (ch.send as (opts: unknown) => Promise<unknown>)({ components: [c], flags: CV2_FLAG }).catch(() => null);
		});

		// ── Error / stuck ────────────────────────────────────────────────────────
		// Moonlink already skips on exception/stuck when autoSkipOnError / skipStuckTracks
		// are enabled. Calling skip() again here races NodeLink mid-stream and causes HTTP 500s.

		const lastFailNotice = new Map<string, number>();
		async function notifyPlaybackFail(
			guildId: string,
			textChannelId: string | null | undefined,
			message: string,
			color: number,
		) {
			const now = Date.now();
			if ((lastFailNotice.get(guildId) ?? 0) + 8_000 > now) return;
			lastFailNotice.set(guildId, now);

			const ch = await getChannel(textChannelId);
			if (!ch) return;
			const c = makeContainer({ color });
			c.addTextDisplayComponents(new TextDisplayBuilder().setContent(message));
			await (ch.send as (opts: unknown) => Promise<unknown>)({ components: [c], flags: CV2_FLAG }).catch(() => null);
		}

		music.on(
			'trackException',
			async (player: Player, track: Track, exception?: { message?: string; severity?: string }) => {
				const detail = exception?.message ? ` (${exception.message})` : '';
				logger.error(`[music] Track exception: ${track?.title} in guild ${player.guildId}${detail}`);
				await notifyPlaybackFail(
					player.guildId,
					player.textChannelId,
					`Couldn't play **${track?.title ?? 'Unknown'}** — skipping.`,
					Colors.Error,
				);
			},
		);

		music.on('trackStuck', async (player: Player, track: Track) => {
			logger.warn(`[music] Track stuck: ${track?.title} in guild ${player.guildId}`);
			await notifyPlaybackFail(
				player.guildId,
				player.textChannelId,
				`Track stuck — skipping **${track?.title ?? 'Unknown'}**.`,
				Colors.Warning,
			);
		});
	}
}
