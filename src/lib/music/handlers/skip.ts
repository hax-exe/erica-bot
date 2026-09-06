import { type Command, container } from '@sapphire/framework';
import { GuildMember } from 'discord.js';
import { ensureAutoplayBuffer, isAutoplayOn } from '../../AutoplayManager.js';
import { errorReply, successReply, warningReply } from '../../components.js';
import { inSameVC } from '../../MusicManager.js';

export class SkipHandler {
	public async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const player = container.music.players.get(interaction.guildId);
		if (!player?.playing && !player?.current) return interaction.editReply(errorReply('Nothing is playing right now.'));

		const member =
			interaction.member instanceof GuildMember
				? interaction.member
				: await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

		if (!inSameVC(player.voiceChannelId, member?.voice.channel?.id)) {
			return interaction.editReply(warningReply('You must be in the same voice channel.'));
		}

		const to = interaction.options.getInteger('to') ?? 1;
		const title = player.current?.title ?? 'the current track';
		const seed = player.current;

		// Prefill before skip when the upcoming queue would empty — keeps autoplay alive
		if (isAutoplayOn(interaction.guildId) && player.queue.size < to) {
			await ensureAutoplayBuffer(player, seed).catch(() => 0);
		}

		if (to === 1) {
			await player.skip().catch(() => null);
			if (isAutoplayOn(interaction.guildId)) {
				void ensureAutoplayBuffer(player, seed).catch(() => null);
			}
			return interaction.editReply(successReply(`Skipped **${title}**.`));
		}

		for (let i = 0; i < to; i++) {
			if (!player.current && !player.playing) break;
			await player.skip().catch(() => null);
		}
		if (isAutoplayOn(interaction.guildId)) {
			void ensureAutoplayBuffer(player, seed).catch(() => null);
		}
		return interaction.editReply(successReply(`Skipped **${to}** tracks.`));
	}
}
