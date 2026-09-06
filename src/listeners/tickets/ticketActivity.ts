import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Events, type Message } from 'discord.js';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../../lib/database.js';

@ApplyOptions<Listener.Options>({
	name: 'ticketActivity',
	event: Events.MessageCreate,
})
export class TicketActivityListener extends Listener<typeof Events.MessageCreate> {
	public override async run(message: Message) {
		if (message.author.bot || !message.inGuild()) return;
		if (!message.channel.isTextBased()) return;

		try {
			// Fast check if channel is a ticket
			const ticket = await db
				.select({ id: schema.tickets.id, status: schema.tickets.status })
				.from(schema.tickets)
				.where(and(eq(schema.tickets.channelId, message.channel.id), eq(schema.tickets.status, 'open')))
				.limit(1)
				.then((r) => r[0] ?? null);

			if (ticket) {
				// Update lastActivityAt and reset inactivity warning
				await db
					.update(schema.tickets)
					.set({
						lastActivityAt: new Date(),
						inactivityWarningSent: false,
					})
					.where(eq(schema.tickets.id, ticket.id));
			}
		} catch (err) {
			this.container.logger.error('[TicketActivity] Failed to update activity:', err);
		}
	}
}
