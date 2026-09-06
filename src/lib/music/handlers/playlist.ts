import { container } from '@sapphire/framework';
import type { Subcommand } from '@sapphire/plugin-subcommands';
import { MessageFlags, TextDisplayBuilder } from 'discord.js';
import { and, eq } from 'drizzle-orm';
import type { Track } from 'moonlink.js';
import type { PlaylistTrack } from '../../../db/schema.js';
import {
	Colors,
	CV2_FLAG,
	errorReply,
	makeContainer,
	separator,
	successReply,
	warningReply,
} from '../../components.js';
import { db, schema } from '../../database.js';
import { formatDuration, inSameVC } from '../../MusicManager.js';

const MAX_PLAYLISTS = 10;
const MAX_TRACKS = 100;

export class PlaylistHandler {
	public async runSave(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const name = interaction.options.getString('name', true).trim();
		const member = interaction.member;
		const memberVcId = member?.voice?.channel?.id;
		if (!memberVcId) return interaction.editReply(errorReply('You must be in a voice channel.'));

		const player = container.music.players.get(interaction.guildId);
		if (player && !inSameVC(player.voiceChannelId, memberVcId)) {
			return interaction.editReply(errorReply('You must be in the same voice channel as the bot.'));
		}
		if (!player?.current) return interaction.editReply(errorReply('Nothing is playing right now.'));

		const existing = await db.query.musicPlaylists.findMany({
			where: eq(schema.musicPlaylists.userId, interaction.user.id),
		});
		if (existing.length >= MAX_PLAYLISTS) {
			return interaction.editReply(errorReply(`You can have at most ${MAX_PLAYLISTS} playlists. Delete one first.`));
		}

		const queueTracks: Track[] = player.current ? [player.current, ...player.queue.tracks] : [...player.queue.tracks];
		if (!queueTracks.length) return interaction.editReply(errorReply('The queue is empty.'));

		const tracks: PlaylistTrack[] = queueTracks.slice(0, MAX_TRACKS).map((t) => ({
			title: t.title ?? 'Unknown',
			uri: t.uri ?? '',
			author: t.author ?? 'Unknown',
			duration: t.duration ?? 0,
		}));

		await db
			.insert(schema.musicPlaylists)
			.values({
				userId: interaction.user.id,
				guildId: interaction.guildId,
				name,
				tracks: JSON.stringify(tracks),
			})
			.onDuplicateKeyUpdate({
				set: { tracks: JSON.stringify(tracks), guildId: interaction.guildId },
			});

		return interaction.editReply(
			successReply(`Saved **${tracks.length}** track${tracks.length === 1 ? '' : 's'} as playlist **${name}**.`),
		);
	}

	public async runLoad(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const name = interaction.options.getString('name', true);

		const pl = await db.query.musicPlaylists.findFirst({
			where: and(eq(schema.musicPlaylists.userId, interaction.user.id), eq(schema.musicPlaylists.name, name)),
		});
		if (!pl) return interaction.editReply(errorReply(`No playlist named **${name}** found.`));

		const tracks: PlaylistTrack[] = JSON.parse(pl.tracks);
		if (!tracks.length) return interaction.editReply(errorReply('That playlist is empty.'));

		const member = interaction.member;
		if (!member || !member.voice?.channel) {
			return interaction.editReply(errorReply('You must be in a voice channel.'));
		}
		const voiceChannel = member.voice.channel;
		const existingPlayer = container.music.players.get(interaction.guildId);
		if (existingPlayer && !inSameVC(existingPlayer.voiceChannelId, voiceChannel.id)) {
			return interaction.editReply(errorReply('You must be in the same voice channel as the bot.'));
		}
		let player = container.music.players.get(interaction.guildId);
		if (!player) {
			player = container.music.players.create({
				guildId: interaction.guildId,
				voiceChannelId: voiceChannel.id,
				textChannelId: interaction.channelId,
				autoPlay: false,
			});
		}

		if (!player.connected) {
			await player.connect();
		}

		let loaded = 0;
		for (const track of tracks) {
			if (!track.uri) continue;
			try {
				const result = await container.music.search({ query: track.uri, source: 'ytmsearch' });
				if (result?.tracks?.[0]) {
					result.tracks[0].requester = interaction.user.id;
					player.queue.add(result.tracks[0]);
					loaded++;
				}
			} catch {
				// Skip tracks that fail to resolve
			}
		}

		if (!player.playing && !player.paused) {
			await player.play();
		}

		return interaction.editReply(
			successReply(`Loaded **${loaded}** track${loaded === 1 ? '' : 's'} from **${name}** into the queue.`),
		);
	}

	public async runList(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const playlists = await db.query.musicPlaylists.findMany({
			where: eq(schema.musicPlaylists.userId, interaction.user.id),
		});

		if (!playlists.length) return interaction.editReply(errorReply('You have no saved playlists.'));

		const lines = playlists.map((pl) => {
			const tracks: PlaylistTrack[] = JSON.parse(pl.tracks);
			return `• **${pl.name}** — ${tracks.length} track${tracks.length === 1 ? '' : 's'}`;
		});

		const c = makeContainer({ color: Colors.Info, header: 'Your Playlists' });
		c.addSeparatorComponents(separator());
		c.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
		c.addSeparatorComponents(separator());
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(`-# ${playlists.length}/${MAX_PLAYLISTS} playlists saved`),
		);

		// biome-ignore lint/suspicious/noExplicitAny: CV2 flag type gap
		return interaction.editReply({ components: [c], flags: (CV2_FLAG | MessageFlags.Ephemeral) as any });
	}

	public async runView(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const name = interaction.options.getString('name', true);
		const pl = await db.query.musicPlaylists.findFirst({
			where: and(eq(schema.musicPlaylists.userId, interaction.user.id), eq(schema.musicPlaylists.name, name)),
		});
		if (!pl) return interaction.editReply(errorReply(`No playlist named **${name}** found.`));

		const tracks: PlaylistTrack[] = JSON.parse(pl.tracks);
		if (!tracks.length) return interaction.editReply(warningReply('That playlist is empty.'));

		const lines = tracks
			.slice(0, 20)
			.map((t, i) => `\`${i + 1}.\` **${t.title}** by ${t.author} — \`${formatDuration(t.duration)}\``);
		if (tracks.length > 20) lines.push(`-# … and ${tracks.length - 20} more`);

		const c = makeContainer({ color: Colors.Info, header: name });
		c.addSeparatorComponents(separator());
		c.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
		c.addSeparatorComponents(separator());
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`-# ${tracks.length} track${tracks.length === 1 ? '' : 's'} • Total: ${formatDuration(tracks.reduce((acc, t) => acc + t.duration, 0))}`,
			),
		);

		// biome-ignore lint/suspicious/noExplicitAny: CV2 flag type gap
		return interaction.editReply({ components: [c], flags: (CV2_FLAG | MessageFlags.Ephemeral) as any });
	}

	public async runDelete(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const name = interaction.options.getString('name', true);
		const result = await db
			.delete(schema.musicPlaylists)
			.where(and(eq(schema.musicPlaylists.userId, interaction.user.id), eq(schema.musicPlaylists.name, name)));
		const affected = Number((result as any)[0]?.affectedRows ?? 0);

		if (affected === 0) return interaction.editReply(errorReply(`No playlist named **${name}** found.`));
		return interaction.editReply(successReply(`Playlist **${name}** deleted.`));
	}
}
