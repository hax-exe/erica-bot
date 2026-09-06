import { type Command, container } from '@sapphire/framework';
import { GuildMember } from 'discord.js';
import { errorReply, successReply, warningReply } from '../../components.js';
import { inSameVC, saveMusicQueue } from '../../MusicManager.js';

export class RemoveHandler {
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

		const pos = interaction.options.getInteger('position', true);
		const tracks = player.queue.tracks ?? [];
		if (pos > tracks.length) {
			return interaction.editReply(errorReply(`Position out of range. Queue has **${tracks.length}** track(s).`));
		}

		const removed = tracks[pos - 1];
		player.queue.remove(pos - 1);
		await saveMusicQueue(player);
		return interaction.editReply(successReply(`Removed **${removed.title}** from position ${pos}.`));
	}
}
