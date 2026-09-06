import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Events, type Interaction, MessageFlags } from 'discord.js';
import { isBotBlacklisted } from '../../lib/BlacklistUtil.js';
import { CV2_FLAG, errorReply, successReply } from '../../lib/components.js';
import {
	buildStatusData,
	buildStatusPanel,
	isSubscribed,
	runAllChecks,
	subscribeUser,
	unsubscribeUser,
} from '../../lib/StatusUtil.js';

@ApplyOptions<Listener.Options>({
	name: 'statusButtonHandler',
	event: Events.InteractionCreate,
})
export class StatusButtonListener extends Listener<typeof Events.InteractionCreate> {
	public override async run(interaction: Interaction) {
		if (!interaction.isButton()) return;
		if (await isBotBlacklisted(interaction.user.id)) return;

		// ── Refresh ───────────────────────────────────────────────────────────────
		if (interaction.customId === 'status:refresh') {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });

			const statusMap = await runAllChecks();
			const categories = await buildStatusData(statusMap);
			const { container, row } = await buildStatusPanel(categories, new Date());

			try {
				await interaction.message.edit({ components: [container, row], flags: CV2_FLAG });
				return interaction.editReply(successReply('Status panel refreshed.'));
			} catch {
				return interaction.editReply(errorReply('Could not refresh the panel.'));
			}
		}

		// ── Subscribe ─────────────────────────────────────────────────────────────
		if (interaction.customId === 'status:subscribe') {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			const already = await isSubscribed(interaction.user.id);
			if (already) {
				return interaction.editReply(
					successReply(
						"You're already subscribed. You'll receive a DM whenever a status incident is created or updated.",
					),
				);
			}
			await subscribeUser(interaction.user.id);
			return interaction.editReply(
				successReply("Subscribed! You'll receive a DM whenever a status incident is created or updated."),
			);
		}

		// ── Unsubscribe ───────────────────────────────────────────────────────────
		if (interaction.customId === 'status:unsubscribe') {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			await unsubscribeUser(interaction.user.id);
			return interaction.editReply(successReply("You've been unsubscribed from status updates."));
		}
	}
}
