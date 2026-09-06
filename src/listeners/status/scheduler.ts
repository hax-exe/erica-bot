import { ApplyOptions } from '@sapphire/decorators';
import { container, Listener } from '@sapphire/framework';
import { type Client, Events } from 'discord.js';
import { eq } from 'drizzle-orm';
import { CV2_FLAG } from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';
import { buildStatusData, buildStatusPanel, getStatusConfig, runAllChecks } from '../../lib/StatusUtil.js';

async function updateStatusPanel(client: Client<true>): Promise<void> {
	const statusMap = await runAllChecks();

	const [panel] = await db.select().from(schema.statusPanel).where(eq(schema.statusPanel.id, 1));
	if (!panel) return; // no panel posted yet

	const guild = client.guilds.cache.get(panel.guildId);
	if (!guild) return;

	const channel = guild.channels.cache.get(panel.channelId);
	if (!channel?.isTextBased()) return;

	const categories = await buildStatusData(statusMap);
	const { container: panelContainer, row } = await buildStatusPanel(categories, new Date());

	try {
		const message = await channel.messages.fetch(panel.messageId);
		await message.edit({ components: [panelContainer, row], flags: CV2_FLAG });
	} catch (err) {
		container.logger.warn('[status] Could not edit panel message (may have been deleted):', err);
	}
}

@ApplyOptions<Listener.Options>({
	name: 'statusScheduler',
	event: Events.ClientReady,
	once: true,
})
export class StatusSchedulerListener extends Listener<typeof Events.ClientReady> {
	public override async run(client: Client<true>) {
		const config = getStatusConfig();

		// Run immediately on startup
		await updateStatusPanel(client).catch((err) => this.container.logger.error('[status] startup check failed:', err));
		let lastCheckAt = Date.now();

		// Poll the configured interval dynamically so /status reload takes effect without a restart.
		setInterval(() => {
			const intervalMs = getStatusConfig().intervalMinutes * 60_000;
			if (Date.now() - lastCheckAt < intervalMs) return;
			lastCheckAt = Date.now();
			updateStatusPanel(client).catch((err) => container.logger.error('[status] interval check failed:', err));
		}, 30_000);

		container.logger.info(`[status] Scheduler started — checking every ${config.intervalMinutes}m`);
	}
}
