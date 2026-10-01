import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import {
	Events,
	type Interaction,
	MessageFlags,
	type MessageMentionOptions,
	PermissionFlagsBits,
	TextDisplayBuilder,
	userMention,
} from 'discord.js';
import { ANNOUNCE_COLOR_PRESETS } from '../../commands/moderation/mod.js';
import { isBotBlacklisted } from '../../lib/BlacklistUtil.js';
import { CV2_FLAG, errorReply, makeContainer, separator, successReply } from '../../lib/components.js';

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
		const color = ANNOUNCE_COLOR_PRESETS[colorKey] ?? ANNOUNCE_COLOR_PRESETS.blue;

		const heading = interaction.fields.getTextInputValue('heading') || null;
		const body = interaction.fields.getTextInputValue('body');

		const channel = interaction.guild.channels.cache.get(channelId);
		if (!channel?.isTextBased()) {
			return interaction.editReply(errorReply('Could not find the target channel.'));
		}

		// Mirror Discord's own rule: @everyone and non-mentionable roles need Mention Everyone in that channel.
		if (pingType === 'r' && pingId) {
			const role = pingId === interaction.guildId ? null : interaction.guild.roles.cache.get(pingId);
			const needsMentionEveryone = pingId === interaction.guildId || (role != null && !role.mentionable);
			if (
				needsMentionEveryone &&
				!channel.permissionsFor(interaction.member)?.has(PermissionFlagsBits.MentionEveryone)
			) {
				return interaction.editReply(
					errorReply('You need the **Mention @everyone, @here, and All Roles** permission to ping that role there.'),
				);
			}
		}

		// Reconstruct the ping from the encoded type + ID, allowing exactly that one mention to notify.
		// The @everyone role is only pinged by the literal `@everyone` text, not its `<@&id>` role mention.
		let ping: { content: string; allowedMentions: MessageMentionOptions } | undefined;
		if (pingType === 'r' && pingId === interaction.guildId) {
			ping = { content: '@everyone', allowedMentions: { parse: ['everyone'] } };
		} else if (pingType === 'r' && pingId) {
			ping = { content: `<@&${pingId}>`, allowedMentions: { roles: [pingId] } };
		} else if (pingType === 'u' && pingId) {
			ping = { content: `<@${pingId}>`, allowedMentions: { users: [pingId] } };
		}

		const container = makeContainer({ color, header: heading ?? undefined });
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
		container.addSeparatorComponents(separator());
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`-# Announced by ${userMention(interaction.user.id)} • <t:${Math.floor(Date.now() / 1000)}:f>`,
			),
		);

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
