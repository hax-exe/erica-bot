import { type Command, container } from '@sapphire/framework';
import { GuildMember } from 'discord.js';
import { errorReply, successReply, warningReply } from '../../components.js';
import { inSameVC, saveMusicQueue } from '../../MusicManager.js';

const LOOP_MODES = ['off', 'track', 'queue'] as const;
type LoopMode = (typeof LOOP_MODES)[number];

const LOOP_LABELS: Record<LoopMode, string> = {
	off: '⛔ No loop',
	track: '🔂 Loop track',
	queue: '🔁 Loop queue',
};

export class LoopHandler {
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

		const raw = interaction.options.getString('mode');
		let next: LoopMode;

		if (raw) {
			next = raw as LoopMode;
		} else {
			// Cycle: off → track → queue → off
			const current = (player.loop as LoopMode) ?? 'off';
			const idx = LOOP_MODES.indexOf(current);
			next = LOOP_MODES[(idx + 1) % LOOP_MODES.length];
		}

		player.setLoop(next);
		await saveMusicQueue(player);
		return interaction.editReply(successReply(`Loop mode set to **${LOOP_LABELS[next]}**.`));
	}
}
