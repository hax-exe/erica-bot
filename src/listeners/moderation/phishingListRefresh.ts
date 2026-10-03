import { ApplyOptions } from '@sapphire/decorators';
import { container, Listener } from '@sapphire/framework';
import { Events } from 'discord.js';
import { PHISHING_REFRESH_INTERVAL_MS, refreshPhishingList } from '../../lib/PhishingUtil.js';

/** Loads the scam link list when the bot is ready, then refreshes it every 6 hours. */
async function refresh(): Promise<void> {
	const result = await refreshPhishingList();
	if (result.ok) {
		container.logger.info(`[Phishing] Loaded ${result.size} scam domains.`);
	} else {
		// The previous list (if any) stays in use.
		container.logger.warn(`[Phishing] List refresh failed, keeping the previous list: ${result.error}`);
	}
}

@ApplyOptions<Listener.Options>({
	name: 'phishingListRefresh',
	event: Events.ClientReady,
	once: true,
})
export class PhishingListRefreshListener extends Listener<typeof Events.ClientReady> {
	public override run() {
		// Not awaited: a slow download must not hold up the rest of startup.
		void refresh();

		const timer = setInterval(() => void refresh(), PHISHING_REFRESH_INTERVAL_MS);
		timer.unref?.();
	}
}
