import type { Subcommand } from '@sapphire/plugin-subcommands';
import { MessageFlags, TextDisplayBuilder } from 'discord.js';
import { eq } from 'drizzle-orm';
import { Colors, CV2_FLAG, errorReply, makeContainer, separator, successReply } from '../../../lib/components.js';
import { db, schema } from '../../../lib/database.js';
import { updateStatsChannels } from '../../../lib/StatsChannelUtil.js';

export class ServerStatsHandler {
	public async runSetup(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const membersChannel = interaction.options.getChannel('members');
		const onlineChannel = interaction.options.getChannel('online');
		const botsChannel = interaction.options.getChannel('bots');
		const channelsChannel = interaction.options.getChannel('channels');

		if (!membersChannel && !onlineChannel && !botsChannel && !channelsChannel) {
			return interaction.editReply(errorReply('Provide at least one channel to configure.'));
		}

		const existing = await db.query.statsChannels.findFirst({
			where: eq(schema.statsChannels.guildId, interaction.guildId),
		});

		const update: Partial<typeof schema.statsChannels.$inferInsert> = {};
		if (membersChannel) update.memberCountChannelId = membersChannel.id;
		if (onlineChannel) update.onlineCountChannelId = onlineChannel.id;
		if (botsChannel) update.botCountChannelId = botsChannel.id;
		if (channelsChannel) update.channelCountChannelId = channelsChannel.id;

		if (existing) {
			await db.update(schema.statsChannels).set(update).where(eq(schema.statsChannels.guildId, interaction.guildId));
		} else {
			await db.insert(schema.statsChannels).values({ guildId: interaction.guildId, ...update });
		}

		// Immediately update the channels
		await updateStatsChannels(interaction.guild).catch(() => null);

		const parts: string[] = [];
		if (membersChannel) parts.push(`Members → <#${membersChannel.id}>`);
		if (onlineChannel) parts.push(`Online → <#${onlineChannel.id}>`);
		if (botsChannel) parts.push(`Bots → <#${botsChannel.id}>`);
		if (channelsChannel) parts.push(`Channels → <#${channelsChannel.id}>`);

		return interaction.editReply(successReply(`Stats channels configured:\n${parts.join('\n')}`));
	}

	public async runRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const stat = interaction.options.getString('stat', true);

		const update: Partial<typeof schema.statsChannels.$inferInsert> = {};
		if (stat === 'all') {
			update.memberCountChannelId = null;
			update.onlineCountChannelId = null;
			update.botCountChannelId = null;
			update.channelCountChannelId = null;
		} else if (stat === 'members') update.memberCountChannelId = null;
		else if (stat === 'online') update.onlineCountChannelId = null;
		else if (stat === 'bots') update.botCountChannelId = null;
		else if (stat === 'channels') update.channelCountChannelId = null;

		await db
			.insert(schema.statsChannels)
			.values({ guildId: interaction.guildId, ...update })
			.onDuplicateKeyUpdate({ set: update });

		return interaction.editReply(successReply(`Removed **${stat}** stats channel.`));
	}

	public async runView(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const cfg = await db.query.statsChannels.findFirst({
			where: eq(schema.statsChannels.guildId, interaction.guildId),
		});

		const fmt = (id: string | null | undefined) => (id ? `<#${id}>` : '*(not set)*');

		const c = makeContainer({ color: Colors.Info, header: 'Stats Channels' });
		c.addSeparatorComponents(separator());
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				[
					`**Members** ${fmt(cfg?.memberCountChannelId)}`,
					`**Online** ${fmt(cfg?.onlineCountChannelId)}`,
					`**Bots** ${fmt(cfg?.botCountChannelId)}`,
					`**Channels** ${fmt(cfg?.channelCountChannelId)}`,
				].join('\n'),
			),
		);

		// biome-ignore lint/suspicious/noExplicitAny: CV2 flag type gap
		return interaction.editReply({ components: [c], flags: (CV2_FLAG | MessageFlags.Ephemeral) as any });
	}
}
