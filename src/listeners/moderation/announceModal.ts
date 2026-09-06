import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Events, type Interaction, MessageFlags, TextDisplayBuilder, userMention } from 'discord.js';
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

		// Custom ID format: announce_modal:CHANNEL_ID:COLOR:PING_TYPE:PING_ID
		const [, channelId, colorKey, pingType, pingId] = interaction.customId.split(':');
		const color = ANNOUNCE_COLOR_PRESETS[colorKey] ?? ANNOUNCE_COLOR_PRESETS.blue;

		const heading = interaction.fields.getTextInputValue('heading') || null;
		const body = interaction.fields.getTextInputValue('body');

		const channel = interaction.guild.channels.cache.get(channelId);
		if (!channel?.isTextBased()) {
			return interaction.editReply(errorReply('Could not find the target channel.'));
		}

		// Reconstruct the ping mention from the encoded type + ID
		let pingContent: string | undefined;
		if (pingType === 'r' && pingId) {
			pingContent = `<@&${pingId}>`;
		} else if (pingType === 'u' && pingId) {
			pingContent = `<@${pingId}>`;
		}

		const container = makeContainer({ color, header: heading ?? undefined });
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
		container.addSeparatorComponents(separator());
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`-# Announced by ${userMention(interaction.user.id)} • <t:${Math.floor(Date.now() / 1000)}:f>`,
			),
		);

		// Ping must be sent as plain content before the CV2 container (can't mix both).
		if (pingContent) {
			await channel.send({ content: pingContent });
		}
		await channel.send({ components: [container], flags: CV2_FLAG });

		return interaction.editReply(successReply(`Announcement sent to <#${channelId}>.`));
	}
}
