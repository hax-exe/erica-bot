import { type Command, container } from '@sapphire/framework';
import { GuildMember } from 'discord.js';
import { errorReply, successReply, warningReply } from '../../components.js';
import { formatDuration, inSameVC } from '../../MusicManager.js';

/** Parse time like "+30s", "-15", "+1:30", "1:30", "90" -> { ms, relative, sign } or null if invalid. */
function parseTime(raw: string): { ms: number; relative: boolean; sign: number } | null {
	const clean = raw.trim().toLowerCase();
	let relative = false;
	let sign = 1;
	let rest = clean;

	if (clean.startsWith('+')) {
		relative = true;
		sign = 1;
		rest = clean.slice(1);
	} else if (clean.startsWith('-')) {
		relative = true;
		sign = -1;
		rest = clean.slice(1);
	}

	if (rest.endsWith('s')) {
		rest = rest.slice(0, -1);
	}

	const parts = rest.split(':').map(Number);
	if (parts.some(Number.isNaN)) return null;

	let ms = 0;
	if (parts.length === 1) {
		ms = parts[0] * 1000;
	} else if (parts.length === 2) {
		ms = (parts[0] * 60 + parts[1]) * 1000;
	} else if (parts.length === 3) {
		ms = (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
	} else {
		return null;
	}

	return { ms, relative, sign };
}

export class SeekHandler {
	public async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const player = container.music.players.get(interaction.guildId);
		if (!player?.current) return interaction.editReply(errorReply('Nothing is playing right now.'));
		if (!player.current.isSeekable)
			return interaction.editReply(warningReply("This track isn't seekable (e.g. live stream)."));

		const member =
			interaction.member instanceof GuildMember
				? interaction.member
				: await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

		if (!inSameVC(player.voiceChannelId, member?.voice.channel?.id)) {
			return interaction.editReply(warningReply('You must be in the same voice channel.'));
		}

		const raw = interaction.options.getString('time', true);
		const parsed = parseTime(raw);
		if (parsed === null)
			return interaction.editReply(errorReply('Invalid time format. Use `1:30`, `90`, `+30s`, or `-15s`.'));

		const duration = player.current.duration ?? 0;
		const currentPos = player.current.position ?? 0;
		let targetMs = parsed.ms;

		if (parsed.relative) {
			targetMs = currentPos + parsed.sign * parsed.ms;
		}

		if (targetMs < 0) targetMs = 0;
		if (targetMs > duration) {
			return interaction.editReply(
				errorReply(
					`Target position out of range. Track length: \`${formatDuration(duration)}\`. Tried seeking to \`${formatDuration(targetMs)}\`.`,
				),
			);
		}

		player.seek(targetMs);
		return interaction.editReply(successReply(`Seeked to \`${formatDuration(targetMs)}\`.`));
	}
}
