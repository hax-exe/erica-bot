import type { Subcommand } from '@sapphire/plugin-subcommands';
import { MessageFlags, TextDisplayBuilder } from 'discord.js';
import { eq } from 'drizzle-orm';
import { Colors, CV2_FLAG, errorReply, makeContainer, separator, successReply } from '../../../lib/components.js';
import { db, schema } from '../../../lib/database.js';

const DEFAULT_BOOST_MESSAGE = '🚀 {user} just boosted **{server}**! Thank you so much! 💜';

export class BoostHandler {
	public async runSetup(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const channel = interaction.options.getChannel('channel', true);

		await db
			.insert(schema.boostSettings)
			.values({ guildId: interaction.guildId, channelId: channel.id })
			.onDuplicateKeyUpdate({ set: { channelId: channel.id } });

		return interaction.editReply(successReply(`Boost announcements will post in <#${channel.id}>.`));
	}

	public async runMessage(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const text = interaction.options.getString('text', true);

		await db
			.insert(schema.boostSettings)
			.values({ guildId: interaction.guildId, message: text })
			.onDuplicateKeyUpdate({ set: { message: text } });

		return interaction.editReply(successReply(`Boost message updated.\nPreview:\n> ${text}`));
	}

	public async runMilestones(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const raw = interaction.options.getString('counts', true);
		const milestoneChannel = interaction.options.getChannel('channel');

		const milestones = raw
			.split(',')
			.map((s) => parseInt(s.trim(), 10))
			.filter((n) => !Number.isNaN(n) && n > 0)
			.sort((a, b) => a - b);

		if (!milestones.length) return interaction.editReply(errorReply('No valid milestone counts provided.'));

		const patch: Partial<typeof schema.boostSettings.$inferInsert> = {
			milestones: JSON.stringify(milestones),
		};
		if (milestoneChannel) patch.milestoneChannelId = milestoneChannel.id;

		await db
			.insert(schema.boostSettings)
			.values({ guildId: interaction.guildId, ...patch })
			.onDuplicateKeyUpdate({ set: patch });

		return interaction.editReply(
			successReply(`Milestones set: ${milestones.join(', ')} boost${milestones.length === 1 ? '' : 's'}.`),
		);
	}

	public async runView(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const cfg = await db.query.boostSettings.findFirst({
			where: eq(schema.boostSettings.guildId, interaction.guildId),
		});

		const fmt = (id: string | null | undefined) => (id ? `<#${id}>` : '*(not set)*');
		const milestones: number[] = cfg ? JSON.parse(cfg.milestones) : [];

		const c = makeContainer({ color: Colors.Info, header: 'Boost Configuration' });
		c.addSeparatorComponents(separator());
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				[
					`**Channel** ${fmt(cfg?.channelId)}`,
					`**Message** ${cfg?.message ?? DEFAULT_BOOST_MESSAGE}`,
					`**Milestones** ${milestones.length ? milestones.join(', ') : '*(none set)*'}`,
					`**Milestone Channel** ${fmt(cfg?.milestoneChannelId ?? cfg?.channelId)}`,
				].join('\n'),
			),
		);

		// biome-ignore lint/suspicious/noExplicitAny: CV2 flag type gap
		return interaction.editReply({ components: [c], flags: (CV2_FLAG | MessageFlags.Ephemeral) as any });
	}

	public async runDisable(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		await db
			.insert(schema.boostSettings)
			.values({ guildId: interaction.guildId, channelId: null })
			.onDuplicateKeyUpdate({ set: { channelId: null } });

		return interaction.editReply(successReply('Boost announcements disabled.'));
	}
}
