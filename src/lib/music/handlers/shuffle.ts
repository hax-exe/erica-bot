import { type Command, container } from '@sapphire/framework';
import { GuildMember } from 'discord.js';
import { errorReply, successReply, warningReply } from '../../components.js';
import { inSameVC, saveMusicQueue } from '../../MusicManager.js';

export class ShuffleHandler {
	public async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const player = container.music.players.get(interaction.guildId);
		if (!player) return interaction.editReply(errorReply('Nothing is playing right now.'));

		if (!player.queue.size) return interaction.editReply(warningReply('The queue is empty — nothing to shuffle.'));

		const member =
			interaction.member instanceof GuildMember
				? interaction.member
				: await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

		if (!inSameVC(player.voiceChannelId, member?.voice.channel?.id)) {
			return interaction.editReply(warningReply('You must be in the same voice channel.'));
		}

		player.queue.shuffle();
		await saveMusicQueue(player);
		return interaction.editReply(successReply('Queue shuffled!'));
	}
}
