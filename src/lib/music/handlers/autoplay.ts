import { type Command, container } from '@sapphire/framework';
import { GuildMember } from 'discord.js';
import { isAutoplayOn, setAutoplay } from '../../AutoplayManager.js';
import { errorReply, successReply, warningReply } from '../../components.js';
import { inSameVC } from '../../MusicManager.js';

export class AutoPlayHandler {
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

		const desired = interaction.options.getBoolean('enabled') ?? !isAutoplayOn(interaction.guildId);
		setAutoplay(interaction.guildId, desired, player);

		return interaction.editReply(
			successReply(
				desired
					? 'Autoplay **on** — related YouTube Music tracks will queue when the queue ends.'
					: 'Autoplay **off**.',
			),
		);
	}
}
