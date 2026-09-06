import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Events, type Interaction, MessageFlags } from 'discord.js';
import { eq } from 'drizzle-orm';
import { isBotBlacklisted } from '../../lib/BlacklistUtil.js';
import { errorReply, successReply } from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';

@ApplyOptions<Listener.Options>({
	name: 'reminderSnoozeButton',
	event: Events.InteractionCreate,
})
export class ReminderSnoozeListener extends Listener<typeof Events.InteractionCreate> {
	public override async run(interaction: Interaction) {
		if (!interaction.isButton()) return;
		if (!interaction.customId.startsWith('reminder:snooze:')) return;
		if (await isBotBlacklisted(interaction.user.id)) return;

		const [, , minutesStr, idStr] = interaction.customId.split(':');
		const minutes = Number.parseInt(minutesStr, 10);
		const reminderId = Number.parseInt(idStr, 10);

		if (Number.isNaN(minutes) || Number.isNaN(reminderId)) return;

		const reminder = await db.query.reminders.findFirst({
			where: eq(schema.reminders.id, reminderId),
		});

		if (!reminder) {
			// biome-ignore lint/suspicious/noExplicitAny: CV2 flag type gap
			return interaction.reply(errorReply('Reminder not found — it may have been deleted.') as any);
		}

		if (reminder.userId !== interaction.user.id) {
			// biome-ignore lint/suspicious/noExplicitAny: CV2 flag type gap
			return interaction.reply(errorReply('Only the reminder owner can snooze it.') as any);
		}

		const newTime = new Date(Date.now() + minutes * 60 * 1000);

		await db
			.update(schema.reminders)
			.set({ done: false, remindAt: newTime })
			.where(eq(schema.reminders.id, reminderId));

		const label = minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`;
		// biome-ignore lint/suspicious/noExplicitAny: CV2 flag type gap
		return interaction.reply({
			...(successReply(
				`Snoozed for **${label}** — I'll remind you <t:${Math.floor(newTime.getTime() / 1000)}:R>.`,
			) as any),
			flags: MessageFlags.Ephemeral,
		});
	}
}
