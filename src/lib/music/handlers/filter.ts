import { type Command, container } from '@sapphire/framework';
import { GuildMember } from 'discord.js';
import { errorReply, successReply, warningReply } from '../../components.js';
import { inSameVC } from '../../MusicManager.js';

type FilterName = 'bassboost' | 'nightcore' | 'vaporwave' | '8d' | 'tremolo' | 'vibrato' | 'karaoke' | 'reset';

export class FilterHandler {
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

		const filter = interaction.options.getString('filter', true) as FilterName;
		const f = player.filters;

		switch (filter) {
			case 'bassboost':
				f.setEqualizer([
					{ band: 0, gain: 0.6 },
					{ band: 1, gain: 0.67 },
					{ band: 2, gain: 0.67 },
					{ band: 3, gain: 0.0 },
					{ band: 4, gain: -0.5 },
					{ band: 5, gain: 0.15 },
					{ band: 6, gain: -0.45 },
					{ band: 7, gain: 0.23 },
					{ band: 8, gain: 0.35 },
					{ band: 9, gain: 0.45 },
					{ band: 10, gain: 0.55 },
					{ band: 11, gain: 0.6 },
					{ band: 12, gain: 0.55 },
				]);
				break;
			case 'nightcore':
				f.setTimescale({ speed: 1.3, pitch: 1.3, rate: 1.0 });
				break;
			case 'vaporwave':
				f.setTimescale({ speed: 0.85, pitch: 0.8, rate: 1.0 });
				break;
			case '8d':
				f.setRotation({ rotationHz: 0.2 });
				break;
			case 'tremolo':
				f.setTremolo({ frequency: 4.0, depth: 0.75 });
				break;
			case 'vibrato':
				f.setVibrato({ frequency: 4.0, depth: 0.75 });
				break;
			case 'karaoke':
				f.setKaraoke({ level: 1.0, monoLevel: 1.0, filterBand: 220.0, filterWidth: 100.0 });
				break;
			case 'reset':
				f.reset();
				break;
		}

		await f.apply();

		const label = filter === 'reset' ? 'all filters' : `**${filter}**`;
		return interaction.editReply(successReply(filter === 'reset' ? 'Reset all filters.' : `Applied ${label} filter.`));
	}
}
