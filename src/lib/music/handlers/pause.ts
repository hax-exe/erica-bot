import { type Command, container } from '@sapphire/framework';
import { GuildMember, MessageFlags } from 'discord.js';
import { updatePlaybackState } from '../../../listeners/music/events.js';
import { errorReply, successReply, warningReply } from '../../components.js';
import { inSameVC, saveMusicQueue } from '../../MusicManager.js';

export class PauseHandler {
	public async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
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

		if (player.paused) return interaction.editReply(warningReply('Already paused. Use `/resume` to continue.'));

		player.pause();
		await saveMusicQueue(player);
		await updatePlaybackState(player);
		return interaction.editReply(successReply('Paused.'));
	}
}
