import { type Command, container } from '@sapphire/framework';
import { GuildMember } from 'discord.js';
import { errorReply, successReply, warningReply } from '../../components.js';
import { inSameVC, saveMusicQueue } from '../../MusicManager.js';

export class ClearQueueHandler {
	public async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const player = container.music.players.get(interaction.guildId);
		if (!player?.current) return interaction.editReply(errorReply('Nothing is playing right now.'));

		const member =
			interaction.member instanceof GuildMember
				? interaction.member
				: await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

		if (!inSameVC(player.voiceChannelId, member?.voice.channel?.id)) {
			return interaction.editReply(warningReply('You must be in the same voice channel.'));
		}

		if (player.queue.size === 0) {
			return interaction.editReply(warningReply('The queue is already empty.'));
		}

		player.queue.clear();
		await saveMusicQueue(player);
		return interaction.editReply(successReply('Cleared the queue. The current track will continue playing.'));
	}
}
