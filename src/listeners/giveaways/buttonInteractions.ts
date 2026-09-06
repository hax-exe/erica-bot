import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { ContainerBuilder, Events, type Interaction, MessageFlags, TextDisplayBuilder } from 'discord.js';
import { and, eq } from 'drizzle-orm';
import { buildGiveawayCard } from '../../commands/general/giveaway.js';
import { isBotBlacklisted } from '../../lib/BlacklistUtil.js';
import { CV2_FLAG, errorReply, warningReply } from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';

@ApplyOptions<Listener.Options>({
	name: 'giveawayButtonInteractions',
	event: Events.InteractionCreate,
})
export class GiveawayButtonListener extends Listener<typeof Events.InteractionCreate> {
	public override async run(interaction: Interaction) {
		if (!interaction.isButton()) return;
		if (!interaction.customId.startsWith('giveaway:enter:')) return;
		if (await isBotBlacklisted(interaction.user.id)) return;

		const giveawayId = parseInt(interaction.customId.slice('giveaway:enter:'.length), 10);
		if (Number.isNaN(giveawayId)) return;

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const giveaway = await db.query.giveaways.findFirst({
			where: eq(schema.giveaways.id, giveawayId),
		});

		if (!giveaway || giveaway.ended || giveaway.cancelled) {
			return interaction.editReply(errorReply('This giveaway has already ended.'));
		}

		if (giveaway.requiredRoleId && interaction.inCachedGuild()) {
			const member = interaction.member;
			if (!member.roles.cache.has(giveaway.requiredRoleId)) {
				return interaction.editReply(
					errorReply(`You need the <@&${giveaway.requiredRoleId}> role to enter this giveaway.`),
				);
			}
		}

		let entrants: string[] | null = null;
		let entered = false;
		for (let attempt = 0; attempt < 3; attempt++) {
			const current = await db.query.giveaways.findFirst({
				where: eq(schema.giveaways.id, giveawayId),
			});
			if (!current || current.ended || current.cancelled) {
				return interaction.editReply(errorReply('This giveaway has already ended.'));
			}

			let parsed: unknown;
			try {
				parsed = JSON.parse(current.entrantIds);
			} catch {
				this.container.logger.error(`[giveaway] Invalid entrant data for giveaway ${giveawayId}`);
				return interaction.editReply(errorReply('This giveaway has invalid entry data. Staff have been notified.'));
			}
			if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === 'string')) {
				this.container.logger.error(`[giveaway] Invalid entrant data for giveaway ${giveawayId}`);
				return interaction.editReply(errorReply('This giveaway has invalid entry data. Staff have been notified.'));
			}

			entered = !parsed.includes(interaction.user.id);
			const next = entered ? [...parsed, interaction.user.id] : parsed.filter((id) => id !== interaction.user.id);
			const claimedResult = await db
				.update(schema.giveaways)
				.set({ entrantIds: JSON.stringify(next) })
				.where(and(eq(schema.giveaways.id, giveawayId), eq(schema.giveaways.entrantIds, current.entrantIds)));
			if (Number((claimedResult as any)[0]?.affectedRows ?? 0) > 0) {
				entrants = next;
				break;
			}
		}
		if (!entrants) return interaction.editReply(errorReply('Entries changed too quickly. Please click again.'));

		await interaction.message
			.edit(
				buildGiveawayCard({
					prize: giveaway.prize,
					hostId: giveaway.hostId,
					endsAt: giveaway.endsAt,
					winnerCount: giveaway.winnerCount,
					entrantCount: entrants.length,
					ended: false,
					giveawayId: giveaway.id,
					requiredRoleId: giveaway.requiredRoleId,
				}) as any,
			)
			.catch(() => null);

		if (!entered) return interaction.editReply(warningReply('You have withdrawn your entry.'));

		const container = new ContainerBuilder().setAccentColor(0x57f287);
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`✅ You've entered the giveaway for **${giveaway.prize}**! Good luck!\n-# Click again to withdraw.`,
			),
		);
		// biome-ignore lint/suspicious/noExplicitAny: CV2 flag type gap
		return interaction.editReply({ components: [container], flags: (CV2_FLAG | MessageFlags.Ephemeral) as any });
	}
}
