import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	type Client,
	ContainerBuilder,
	Events,
	SeparatorBuilder,
	SeparatorSpacingSize,
	TextDisplayBuilder,
} from 'discord.js';
import { and, eq, lte } from 'drizzle-orm';
import { Colors, CV2_FLAG } from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';
import { humanDuration } from '../../lib/parseDuration.js';

@ApplyOptions<Listener.Options>({
	name: 'reminderScheduler',
	event: Events.ClientReady,
	once: true,
})
export class ReminderSchedulerListener extends Listener<typeof Events.ClientReady> {
	public override run(client: Client<true>) {
		let running = false;
		const check = async () => {
			if (running) return;
			running = true;
			try {
				const now = new Date();
				const due = await db.query.reminders.findMany({
					where: and(eq(schema.reminders.done, false), lte(schema.reminders.remindAt, now)),
				});

				for (const reminder of due) {
					try {
						const channel = await client.channels.fetch(reminder.channelId).catch(() => null);
						if (!channel?.isTextBased()) {
							// Channel gone — stop retrying one-off reminders
							if (!reminder.intervalMs) {
								await db
									.update(schema.reminders)
									.set({ done: true })
									.where(and(eq(schema.reminders.id, reminder.id), eq(schema.reminders.done, false)));
							}
							continue;
						}

						const container = new ContainerBuilder().setAccentColor(Colors.Info);
						container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### Reminder`));
						container.addSeparatorComponents(
							new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
						);
						const recurNote = reminder.intervalMs
							? `\n-# 🔁 Repeating every ${humanDuration(reminder.intervalMs)} • Delete with \`/remind delete ${reminder.id}\``
							: '';
						container.addTextDisplayComponents(
							new TextDisplayBuilder().setContent(
								`<@${reminder.userId}> You asked me to remind you:\n\n${reminder.content}${recurNote}`,
							),
						);
						container.addSeparatorComponents(
							new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
						);
						container.addTextDisplayComponents(
							new TextDisplayBuilder().setContent(`-# Set <t:${Math.floor(reminder.createdAt.getTime() / 1000)}:R>`),
						);

						const components: unknown[] = [container];
						if (!reminder.intervalMs) {
							const snoozeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
								new ButtonBuilder()
									.setCustomId(`reminder:snooze:5:${reminder.id}`)
									.setLabel('5m')
									.setEmoji('⏰')
									.setStyle(ButtonStyle.Secondary),
								new ButtonBuilder()
									.setCustomId(`reminder:snooze:15:${reminder.id}`)
									.setLabel('15m')
									.setEmoji('⏰')
									.setStyle(ButtonStyle.Secondary),
								new ButtonBuilder()
									.setCustomId(`reminder:snooze:60:${reminder.id}`)
									.setLabel('1h')
									.setEmoji('⏰')
									.setStyle(ButtonStyle.Secondary),
							);
							components.push(snoozeRow);
						}

						await (channel as import('discord.js').TextChannel).send({
							// biome-ignore lint/suspicious/noExplicitAny: CV2 flag type gap
							components: components as any,
							flags: CV2_FLAG as any,
							allowedMentions: { users: [reminder.userId] },
						});

						// Only mark done / reschedule after a successful send
						if (reminder.intervalMs) {
							await db
								.update(schema.reminders)
								.set({ remindAt: new Date(Date.now() + reminder.intervalMs) })
								.where(
									and(
										eq(schema.reminders.id, reminder.id),
										eq(schema.reminders.done, false),
										eq(schema.reminders.remindAt, reminder.remindAt),
									),
								);
						} else {
							await db
								.update(schema.reminders)
								.set({ done: true })
								.where(and(eq(schema.reminders.id, reminder.id), eq(schema.reminders.done, false)));
						}
					} catch (err) {
						client.logger.warn(`[ReminderScheduler] Failed to deliver reminder ${reminder.id}:`, err);
						// Leave row due so the next tick can retry
					}
				}
			} catch (err) {
				client.logger.error('[ReminderScheduler] Error during check:', err);
			} finally {
				running = false;
			}
		};

		void check();
		setInterval(() => void check(), 60_000);
	}
}
