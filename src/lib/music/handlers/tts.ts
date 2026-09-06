import { type Command, container } from '@sapphire/framework';
import { GuildMember, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { errorReply, successReply, warningReply } from '../../components.js';
import { db, schema } from '../../database.js';
import { isModuleEnabled } from '../../ModuleUtil.js';
import { inSameVC } from '../../MusicManager.js';

export class TtsHandler {
	public async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		// 1. Verify that the TTS module is enabled
		const ttsEnabled = await isModuleEnabled(interaction.guildId, 'tts');
		if (!ttsEnabled) {
			return interaction.editReply(
				errorReply('The TTS module is currently disabled. Enable it with `/config modules`.'),
			);
		}

		// 2. Fetch guild settings to check authorization
		const [guildRow] = await db.select().from(schema.guilds).where(eq(schema.guilds.id, interaction.guildId)).limit(1);

		const roleId = guildRow?.ttsRoleId;
		const member =
			interaction.member instanceof GuildMember
				? interaction.member
				: await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

		if (!member) return interaction.editReply(errorReply('Could not resolve member.'));

		const isAdmin =
			member.permissions.has(PermissionFlagsBits.Administrator) ||
			member.permissions.has(PermissionFlagsBits.ManageGuild);
		const hasTtsRole = roleId && member.roles.cache.has(roleId);

		if (!isAdmin && !hasTtsRole) {
			return interaction.editReply(
				errorReply(
					roleId ? `You must have the <@&${roleId}> role to use TTS.` : 'You must be an Administrator to use TTS.',
				),
			);
		}

		// 3. Check voice channel state
		const vc = member.voice.channel;
		if (!vc) return interaction.editReply(warningReply('Join a voice channel first.'));

		// 4. Retrieve values
		const text = interaction.options.getString('text', true);
		const lang = interaction.options.getString('language') ?? guildRow?.ttsDefaultLanguage ?? 'en';
		const conflictMode = guildRow?.ttsConflictMode ?? 'block';

		const { music } = container;
		let player = music.players.get(interaction.guildId);

		// Handle playback and potential music conflicts
		if (player && player.connected && player.playing && player.current) {
			// If already playing TTS, block
			if (player.current.userData?.isTTS) {
				return interaction.editReply(errorReply('A TTS announcement is already playing.'));
			}

			// Verify same VC
			if (!inSameVC(player.voiceChannelId, vc.id)) {
				return interaction.editReply(warningReply(`I am already active in <#${player.voiceChannelId}>.`));
			}

			if (conflictMode === 'block') {
				return interaction.editReply(
					warningReply('Cannot play TTS while music is playing. Configure this via `/config ttsconflict`.'),
				);
			}

			// Interrupt Mode
			const currentTrack = player.current;
			const position = currentTrack.position ?? 0;

			// Generate TTS track
			const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${lang}&client=tw-ob`;
			const searchRes = await music.search({ query: ttsUrl, requester: interaction.user.id });

			if (!searchRes.tracks.length || searchRes.loadType === 'empty' || searchRes.loadType === 'error') {
				return interaction.editReply(errorReply('Failed to resolve TTS audio from Google Translate.'));
			}

			const ttsTrack = searchRes.tracks[0];
			ttsTrack.userData = { ...ttsTrack.userData, isTTS: true };

			// Prepend the interrupted track to the front of the queue
			currentTrack.userData = { ...currentTrack.userData, resumePosition: position };
			player.queue.unshift(currentTrack);

			// Play TTS immediately
			await player.play(ttsTrack);
			return interaction.editReply(successReply(`Announced: "${text}" (interrupted music).`));
		}

		// Bot is idle or not in VC
		if (!player) {
			player = music.players.create({
				guildId: interaction.guildId,
				voiceChannelId: vc.id,
				textChannelId: interaction.channelId,
				autoPlay: false,
			});
		}

		if (!player.connected) {
			player.setVoiceChannelId(vc.id);
			try {
				await player.connect();
			} catch (err: unknown) {
				return interaction.editReply(errorReply((err as Error).message));
			}
		} else if (player.voiceChannelId !== vc.id) {
			// Move to the user's VC if bot is connected but idle
			player.setVoiceChannelId(vc.id);
			await player.connect();
		}

		const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${lang}&client=tw-ob`;
		const searchRes = await music.search({ query: ttsUrl, requester: interaction.user.id });

		if (!searchRes.tracks.length || searchRes.loadType === 'empty' || searchRes.loadType === 'error') {
			return interaction.editReply(errorReply('Failed to resolve TTS audio from Google Translate.'));
		}

		const ttsTrack = searchRes.tracks[0];
		ttsTrack.userData = { ...ttsTrack.userData, isTTS: true };

		await player.play(ttsTrack);
		return interaction.editReply(successReply(`Announced: "${text}"`));
	}
}

// Let eq helper work
import { eq } from 'drizzle-orm';
