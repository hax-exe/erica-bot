import { type Command, container } from '@sapphire/framework';
import { GuildMember } from 'discord.js';
import { clearNpMessage, resetJukeboxUI } from '../../../listeners/music/events.js';
import { errorReply, successReply, warningReply } from '../../components.js';
import { clearMusicQueue, inSameVC, setVoiceChannelStatus } from '../../MusicManager.js';

export class StopHandler {
	public async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const player = container.music.players.get(interaction.guildId);
		if (!player) return interaction.editReply(errorReply('Nothing is playing right now.'));

		const member =
			interaction.member instanceof GuildMember
				? interaction.member
				: await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

		if (!inSameVC(player.voiceChannelId, member?.voice.channel?.id)) {
			return interaction.editReply(warningReply('You must be in the same voice channel.'));
		}

		const vcId = player.voiceChannelId;
		if (vcId) await setVoiceChannelStatus(container.client, vcId, null);
		await player.destroy();
		await clearMusicQueue(interaction.guildId);
		clearNpMessage(interaction.guildId);
		await resetJukeboxUI(interaction.guildId);
		return interaction.editReply(successReply('Stopped playback and cleared the queue.'));
	}
}
