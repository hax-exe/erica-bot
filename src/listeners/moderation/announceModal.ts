import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Events, type Interaction, MessageFlags, PermissionFlagsBits, userMention } from 'discord.js';
import {
	ANNOUNCE_PING_PERMISSION_ERROR,
	buildAnnouncementContainer,
	buildAnnouncementPing,
	canSendAnnouncePing,
	resolveAnnounceColor,
} from '../../lib/AnnouncementUtil.js';
import { isBotBlacklisted } from '../../lib/BlacklistUtil.js';
import { CV2_FLAG, errorReply, successReply } from '../../lib/components.js';

@ApplyOptions<Listener.Options>({
	name: 'announceModalSubmit',
	event: Events.InteractionCreate,
})
export class AnnounceModalListener extends Listener<typeof Events.InteractionCreate> {
	public override async run(interaction: Interaction) {
		if (!interaction.isModalSubmit()) return;
		if (!interaction.customId.startsWith('announce_modal:')) return;
		if (!interaction.inCachedGuild()) return;
		if (await isBotBlacklisted(interaction.user.id)) return;

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		// `/mod announce` requires Manage Server; re-check here since the modal can ping anyone.
		if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
			return interaction.editReply(errorReply('You need the **Manage Server** permission to send announcements.'));
		}

		// Custom ID format: announce_modal:CHANNEL_ID:COLOR:PING_TYPE:PING_ID
		const [, channelId, colorKey, pingType, pingId] = interaction.customId.split(':');
		const color = resolveAnnounceColor(colorKey);

		const heading = interaction.fields.getTextInputValue('heading') || null;
		const body = interaction.fields.getTextInputValue('body');

		const channel = interaction.guild.channels.cache.get(channelId);
		if (!channel?.isTextBased()) {
			return interaction.editReply(errorReply('Could not find the target channel.'));
		}

		if (!canSendAnnouncePing(interaction.member, channel, pingType, pingId)) {
			return interaction.editReply(errorReply(ANNOUNCE_PING_PERMISSION_ERROR));
		}

		const ping = buildAnnouncementPing(interaction.guildId, pingType, pingId);
		const container = buildAnnouncementContainer({
			color,
			heading,
			body,
			footer: `-# Announced by ${userMention(interaction.user.id)} • <t:${Math.floor(Date.now() / 1000)}:f>`,
		});

		try {
			// Ping must be sent as plain content before the CV2 container (can't mix both).
			if (ping) {
				await channel.send(ping);
			}
			// Mentions typed into the body/heading never notify — only the explicit ping option does.
			await channel.send({ components: [container], flags: CV2_FLAG, allowedMentions: { parse: [] } });
		} catch (err) {
			this.container.logger.error('[Announce] Failed to send announcement:', err);
			return interaction.editReply(
				errorReply(`Failed to send the announcement to <#${channelId}>. Check my permissions in that channel.`),
			);
		}

		return interaction.editReply(successReply(`Announcement sent to <#${channelId}>.`));
	}
}
