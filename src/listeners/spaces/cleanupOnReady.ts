import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { type Client, Events } from 'discord.js';
import { eq } from 'drizzle-orm';
import { db, schema } from '../../lib/database.js';

@ApplyOptions<Listener.Options>({
	name: 'spacesCleanupOnReady',
	event: Events.ClientReady,
	once: true,
})
export class SpacesCleanupOnReadyListener extends Listener<typeof Events.ClientReady> {
	public override async run(client: Client<true>) {
		const spaces = await db.select().from(schema.activeSpaces);
		let cleaned = 0;

		for (const space of spaces) {
			const guild = client.guilds.cache.get(space.guildId);
			if (!guild) {
				await db.delete(schema.activeSpaces).where(eq(schema.activeSpaces.channelId, space.channelId));
				cleaned++;
				continue;
			}

			const channel = guild.channels.cache.get(space.channelId);
			if (!channel) {
				// Channel was deleted while bot was offline
				await db.delete(schema.activeSpaces).where(eq(schema.activeSpaces.channelId, space.channelId));
				cleaned++;
				continue;
			}

			if (channel.isVoiceBased() && channel.members.size === 0) {
				await channel.delete('Empty space on startup cleanup.').catch(() => null);
				await db.delete(schema.activeSpaces).where(eq(schema.activeSpaces.channelId, space.channelId));
				cleaned++;
			}
		}

		if (cleaned > 0) {
			this.container.logger.info(`[spaces] Cleaned up ${cleaned} stale space(s) on startup.`);
		}
	}
}
