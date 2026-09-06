import { ApplyOptions } from '@sapphire/decorators';
import { container, Listener } from '@sapphire/framework';
import { type Client, Events, TextDisplayBuilder, userMention } from 'discord.js';
import { and, eq, or } from 'drizzle-orm';
import { CV2_FLAG } from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';

const DEFAULT_MESSAGE = '🎂 Happy Birthday {user}! Hope you have an amazing day! 🎉';

function resolveBdayMessage(
	template: string | null | undefined,
	userId: string,
	username: string,
	serverName: string,
): string {
	return (template ?? DEFAULT_MESSAGE)
		.replace(/{user}/g, userMention(userId))
		.replace(/{username}/g, username)
		.replace(/{server}/g, serverName);
}

async function checkBirthdays(client: Client<true>): Promise<void> {
	const now = new Date();
	const todayStr = now.toISOString().slice(0, 10); // 'YYYY-MM-DD'
	const month = now.getUTCMonth() + 1;
	const day = now.getUTCDate();
	const year = now.getUTCFullYear();

	// On non-leap years, also wish Feb 29 birthdays on Feb 28
	const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
	const includeFeb29 = month === 2 && day === 28 && !isLeapYear;

	// Fetch all birthdays for today that haven't been wished yet
	const todays = await db
		.select()
		.from(schema.birthdays)
		.where(
			includeFeb29
				? and(eq(schema.birthdays.month, 2), or(eq(schema.birthdays.day, 28), eq(schema.birthdays.day, 29)))
				: and(eq(schema.birthdays.month, month), eq(schema.birthdays.day, day)),
		);

	for (const bday of todays) {
		if (bday.lastWished === todayStr) continue;

		const settings = await db
			.select()
			.from(schema.birthdaySettings)
			.where(eq(schema.birthdaySettings.guildId, bday.guildId))
			.limit(1)
			.then((r) => r[0] ?? null);

		if (!settings?.enabled || !settings.channelId) continue;

		if (!(await isModuleEnabled(bday.guildId, 'birthdays'))) continue;

		const guild = client.guilds.cache.get(bday.guildId);
		if (!guild) continue;

		const member = await guild.members.fetch(bday.userId).catch(() => null);
		if (!member) continue;

		const channel = guild.channels.cache.get(settings.channelId);
		if (!channel?.isTextBased()) continue;

		const message = resolveBdayMessage(settings.message, bday.userId, member.displayName, guild.name);

		// Build CV2 container
		const { ContainerBuilder } = await import('discord.js');
		const containerObj = new ContainerBuilder().setAccentColor(0xf47fff);
		containerObj.addTextDisplayComponents(new TextDisplayBuilder().setContent(message));

		try {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			await (channel.send as (options: unknown) => Promise<unknown>)({ components: [containerObj], flags: CV2_FLAG });

			// Assign birthday role if configured
			if (settings.roleId) {
				await member.roles.add(settings.roleId).catch(() => null);

				// Remove role after 24 hours
				setTimeout(async () => {
					const freshMember = await guild.members.fetch(bday.userId).catch(() => null);
					if (freshMember && settings.roleId) {
						await freshMember.roles.remove(settings.roleId).catch(() => null);
					}
				}, 86_400_000);
			}

			// Mark as wished
			await db
				.update(schema.birthdays)
				.set({ lastWished: todayStr })
				.where(and(eq(schema.birthdays.userId, bday.userId), eq(schema.birthdays.guildId, bday.guildId)));
		} catch (err) {
			container.logger.error('[birthdays] Failed to send birthday message:', err);
		}
	}
}

@ApplyOptions<Listener.Options>({
	name: 'birthdayScheduler',
	event: Events.ClientReady,
	once: true,
})
export class BirthdaySchedulerListener extends Listener<typeof Events.ClientReady> {
	public override async run(client: Client<true>) {
		// Run once immediately on startup (catches any missed birthdays)
		await checkBirthdays(client).catch((err) => this.container.logger.error('[birthdays] startup check failed:', err));

		// Then check every hour
		setInterval(() => {
			checkBirthdays(client).catch((err) => this.container.logger.error('[birthdays] interval check failed:', err));
		}, 3_600_000);
	}
}
