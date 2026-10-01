import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Events, type Interaction, MessageFlags } from 'discord.js';
import { isBotBlacklisted } from '../../lib/BlacklistUtil.js';
import { CV2_FLAG, errorReply, successReply, warningReply } from '../../lib/components.js';
import {
	buildStatusData,
	buildStatusPanel,
	isSubscribed,
	runAllChecks,
	subscribeUser,
	unsubscribeUser,
} from '../../lib/StatusUtil.js';

const USER_REFRESH_COOLDOWN_MS = 30_000;
const GLOBAL_REFRESH_COOLDOWN_MS = 10_000;
/** userId → when that user last triggered a refresh (pruned as entries expire). */
const lastRefreshByUser = new Map<string, number>();
let lastGlobalRefresh = 0;

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
			// Every refresh runs all service checks and edits the panel — rate-limit it per user and globally.
			const now = Date.now();
			const readyAt = Math.max(
				(lastRefreshByUser.get(interaction.user.id) ?? 0) + USER_REFRESH_COOLDOWN_MS,
				lastGlobalRefresh + GLOBAL_REFRESH_COOLDOWN_MS,
			);
			if (now < readyAt) {
				const seconds = Math.ceil((readyAt - now) / 1000);
				return interaction.reply(
					warningReply(`The status panel was refreshed recently. Please wait **${seconds}s** and try again.`) as any,
				);
			}
			lastGlobalRefresh = now;
			lastRefreshByUser.set(interaction.user.id, now);
			for (const [userId, at] of lastRefreshByUser) {
				if (now - at >= USER_REFRESH_COOLDOWN_MS) lastRefreshByUser.delete(userId);
			}

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
