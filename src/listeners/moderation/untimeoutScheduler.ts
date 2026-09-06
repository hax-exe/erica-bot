import { ApplyOptions } from '@sapphire/decorators';
import { container, Listener } from '@sapphire/framework';
import { type Client, Events } from 'discord.js';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { db, schema } from '../../lib/database.js';
import { createInfraction, dispatchModLog } from '../../lib/ModerationUtil.js';

const POLL_INTERVAL_MS = 60_000; // check every minute

let running = false;

async function checkExpiredTimeouts(client: Client<true>): Promise<void> {
	if (running) return;
	running = true;
	try {
		// Find timeout infractions whose duration has elapsed and haven't been logged yet
		// duration is milliseconds; MySQL DATETIME + INTERVAL (not SQLite unixepoch)
		const expired = await db
			.select()
			.from(schema.infractions)
			.where(
				and(
					eq(schema.infractions.type, 'timeout'),
					isNotNull(schema.infractions.duration),
					eq(schema.infractions.untimeoutLogged, false),
					sql`DATE_ADD(${schema.infractions.createdAt}, INTERVAL ${schema.infractions.duration} / 1000 SECOND) < NOW()`,
				),
			);

		for (const infraction of expired) {
			// Claim first so overlapping ticks / member-update paths can't double-log
			const claimedResult = await db
				.update(schema.infractions)
				.set({ untimeoutLogged: true })
				.where(and(eq(schema.infractions.id, infraction.id), eq(schema.infractions.untimeoutLogged, false)));

			if (Number((claimedResult as any)[0]?.affectedRows ?? 0) === 0) continue;

			try {
				const guild = client.guilds.cache.get(infraction.guildId);
				if (!guild) continue;

				const targetUser = await client.users.fetch(infraction.userId).catch(() => null);
				if (!targetUser) continue;

				const botUser = client.user;

				const untimeoutInfraction = await createInfraction({
					guildId: infraction.guildId,
					userId: infraction.userId,
					moderatorId: botUser.id,
					type: 'untimeout',
					reason: 'Timeout expired naturally',
				});

				await dispatchModLog({
					guild,
					targetUser,
					moderator: botUser,
					type: 'untimeout',
					reason: 'Timeout expired naturally',
					caseId: untimeoutInfraction.caseId,
				});
			} catch (err) {
				container.logger.error(`[UntimeoutScheduler] Failed to log expired timeout for ${infraction.userId}:`, err);
			}
		}
	} finally {
		running = false;
	}
}

@ApplyOptions<Listener.Options>({
	name: 'untimeoutScheduler',
	event: Events.ClientReady,
	once: true,
})
export class UntimeoutSchedulerListener extends Listener<typeof Events.ClientReady> {
	public override async run(client: Client<true>) {
		await checkExpiredTimeouts(client).catch((err) =>
			container.logger.error('[UntimeoutScheduler] startup check failed:', err),
		);

		setInterval(() => {
			checkExpiredTimeouts(client).catch((err) =>
				container.logger.error('[UntimeoutScheduler] interval check failed:', err),
			);
		}, POLL_INTERVAL_MS);
	}
}
