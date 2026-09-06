import { type Command, container } from '@sapphire/framework';
import { GuildMember } from 'discord.js';
import { eq } from 'drizzle-orm';
import { errorReply, successReply, warningReply } from '../../components.js';
import { db, schema } from '../../database.js';
import { inSameVC, saveMusicQueue } from '../../MusicManager.js';

export class VolumeHandler {
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

		const level = interaction.options.getInteger('level', true);

		const guildRow = await db.query.guilds.findFirst({ where: eq(schema.guilds.id, interaction.guildId) });
		const maxVol = guildRow?.maxVolumeLimit ?? 100;
		const isMod = member && (member.permissions.has('ManageGuild') || member.permissions.has('Administrator'));

		if (level > maxVol && !isMod) {
			return interaction.editReply(
				warningReply(
					`The volume limit on this server is set to **${maxVol}%**. Only moderators can exceed this limit.`,
				),
			);
		}

		player.setVolume(level);
		await saveMusicQueue(player);
		return interaction.editReply(successReply(`Volume set to **${level}%**.`));
	}
}
