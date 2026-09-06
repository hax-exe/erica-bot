import { ApplyOptions } from '@sapphire/decorators';
import { Events, Listener } from '@sapphire/framework';
import { ChannelType, type Message, PermissionFlagsBits } from 'discord.js';
import { eq } from 'drizzle-orm';
import { isBotBlacklisted } from '../../lib/BlacklistUtil.js';
import { warningReply } from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';

@ApplyOptions<Listener.Options>({
	name: 'ttsMessageCreate',
	event: Events.MessageCreate,
})
export class TtsMessageCreateListener extends Listener<typeof Events.MessageCreate> {
	public override async run(message: Message) {
		if (await isBotBlacklisted(message.author.id)) return;
		// Only process in guilds and ignore bot messages
		if (!message.guild || message.author.bot) return;

		// Only check voice channel text chats
		if (message.channel.type !== ChannelType.GuildVoice) return;

		// 1. Verify that the TTS module is enabled
		const ttsEnabled = await isModuleEnabled(message.guild.id, 'tts');
		if (!ttsEnabled) return;

		// 2. Fetch guild settings to check authorization and default language
		const [guildRow] = await db.select().from(schema.guilds).where(eq(schema.guilds.id, message.guild.id)).limit(1);

		const roleId = guildRow?.ttsRoleId;
		const member = message.member;
		if (!member) return;

		const isAdmin =
			member.permissions.has(PermissionFlagsBits.Administrator) ||
			member.permissions.has(PermissionFlagsBits.ManageGuild);
		const hasTtsRole = roleId && member.roles.cache.has(roleId);

		if (!isAdmin && !hasTtsRole) return; // Not authorized

		// 3. Process text
		const text = message.content.trim();
		if (!text) return; // Skip empty messages (e.g., only attachment or sticker)

		const cleanText = text.slice(0, 200);
		const lang = guildRow?.ttsDefaultLanguage ?? 'en';
		const conflictMode = guildRow?.ttsConflictMode ?? 'block';

		const { music } = this.container;
		let player = music.players.get(message.guild.id);

		// Handle playback and potential music conflicts
		if (player && player.connected && player.playing && player.current) {
			// If already playing TTS, skip/ignore to prevent overlapping/clutter
			if (player.current.userData?.isTTS) return;

			// Verify bot is in the same VC
			if (player.voiceChannelId !== message.channel.id) {
				const reply = await message
					.reply(warningReply("I'm currently active in another voice channel.") as any)
					.catch(() => null);
				if (reply) setTimeout(() => reply.delete().catch(() => null), 5000);
				return;
			}

			if (conflictMode === 'block') {
				const reply = await message
					.reply(warningReply('Cannot play TTS while music is playing.') as any)
					.catch(() => null);
				if (reply) setTimeout(() => reply.delete().catch(() => null), 5000);
				return;
			}

			// Interrupt Mode
			const currentTrack = player.current;
			const position = currentTrack.position ?? 0;

			// Generate TTS track
			const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(cleanText)}&tl=${lang}&client=tw-ob`;
			const searchRes = await music.search({ query: ttsUrl, requester: message.author.id });

			if (!searchRes.tracks.length || searchRes.loadType === 'empty' || searchRes.loadType === 'error') {
				return;
			}

			const ttsTrack = searchRes.tracks[0];
			ttsTrack.userData = { ...ttsTrack.userData, isTTS: true };

			// Prepend the interrupted track to the front of the queue
			currentTrack.userData = { ...currentTrack.userData, resumePosition: position };
			player.queue.unshift(currentTrack);

			// Play TTS immediately
			await player.play(ttsTrack);
			return;
		}

		// Bot is idle or not in VC
		if (!player) {
			player = music.players.create({
				guildId: message.guild.id,
				voiceChannelId: message.channel.id,
				textChannelId: message.channel.id,
				autoPlay: false,
			});
		}

		if (!player.connected) {
			player.setVoiceChannelId(message.channel.id);
			try {
				await player.connect();
			} catch {
				return;
			}
		} else if (player.voiceChannelId !== message.channel.id) {
			player.setVoiceChannelId(message.channel.id);
			await player.connect();
		}

		const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(cleanText)}&tl=${lang}&client=tw-ob`;
		const searchRes = await music.search({ query: ttsUrl, requester: message.author.id });

		if (!searchRes.tracks.length || searchRes.loadType === 'empty' || searchRes.loadType === 'error') {
			return;
		}

		const ttsTrack = searchRes.tracks[0];
		ttsTrack.userData = { ...ttsTrack.userData, isTTS: true };

		await player.play(ttsTrack);
	}
}
