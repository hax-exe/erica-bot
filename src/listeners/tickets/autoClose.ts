import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type Client, Events, TextDisplayBuilder } from 'discord.js';
import { eq } from 'drizzle-orm';
import { Colors, CV2_FLAG, makeContainer } from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';
import { closeTicket, TICKET_CLOSE_ID } from '../../lib/TicketManager.js';

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const WARNING_MS = 48 * 60 * 60 * 1000; // 48 hours
const CLOSE_MS = 72 * 60 * 60 * 1000; // 72 hours

@ApplyOptions<Listener.Options>({
	name: 'ticketAutoClose',
	event: Events.ClientReady,
	once: true,
})
export class TicketAutoCloseListener extends Listener<typeof Events.ClientReady> {
	public override run(client: Client<true>) {
		// Run once on startup after a small delay
		setTimeout(() => this.checkTickets(client), 10_000);

		// Then run on interval
		setInterval(() => this.checkTickets(client), CHECK_INTERVAL_MS);
	}

	private async checkTickets(client: Client<true>) {
		try {
			const now = Date.now();

			// Get all open tickets
			const openTickets = await db.select().from(schema.tickets).where(eq(schema.tickets.status, 'open'));

			for (const ticket of openTickets) {
				const lastActivity = ticket.lastActivityAt.getTime();
				const idleTime = now - lastActivity;

				// 1. Should we close it? (72 hours)
				if (idleTime >= CLOSE_MS) {
					await this.autoCloseTicket(client, ticket);
					continue;
				}

				// 2. Should we warn? (48 hours)
				if (idleTime >= WARNING_MS && !ticket.inactivityWarningSent) {
					await this.sendWarning(client, ticket);
				}
			}
		} catch (err) {
			this.container.logger.error('[TicketAutoClose] Error checking tickets:', err);
		}
	}

	private async sendWarning(client: Client<true>, ticket: typeof schema.tickets.$inferSelect) {
		const guild = client.guilds.cache.get(ticket.guildId);
		if (!guild) return;

		const channel = guild.channels.cache.get(ticket.channelId);
		if (!channel || !channel.isTextBased()) return;

		const c = makeContainer({ color: Colors.Warning, header: 'Inactivity Warning' });
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`<@${ticket.userId}>, this ticket has been inactive for 48 hours.\nIt will be automatically closed in 24 hours if there is no further activity.`,
			),
		);

		c.addActionRowComponents(
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId(`${TICKET_CLOSE_ID}:${ticket.id}`)
					.setLabel('🔒 Close Now')
					.setStyle(ButtonStyle.Danger),
			),
		);

		await channel.send({ components: [c], flags: CV2_FLAG }).catch(() => null);

		await db.update(schema.tickets).set({ inactivityWarningSent: true }).where(eq(schema.tickets.id, ticket.id));

		this.container.logger.info(`[TicketAutoClose] Sent inactivity warning for ticket ${ticket.id}`);
	}

	private async autoCloseTicket(client: Client<true>, ticket: typeof schema.tickets.$inferSelect) {
		const guild = client.guilds.cache.get(ticket.guildId);
		if (!guild) return;

		// We pass null for member because this is an automated close
		// The closeTicket function should handle system closes gracefully
		try {
			await closeTicket(guild, ticket.id, client.user);
			this.container.logger.info(`[TicketAutoClose] Auto-closed ticket ${ticket.id} due to inactivity`);
		} catch (err) {
			this.container.logger.error(`[TicketAutoClose] Failed to auto-close ticket ${ticket.id}:`, err);
		}
	}
}
