import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { type Client, Events, type Guild, type GuildMember, userMention } from 'discord.js';
import { and, eq, lte } from 'drizzle-orm';
import {
	advanceNextRun,
	buildAnnouncementContainer,
	buildAnnouncementPing,
	checkScheduleAuthority,
	resolveAnnounceColor,
} from '../../lib/AnnouncementUtil.js';
import { Colors, CV2_FLAG, logContainer } from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';
import { logFields, sendLog } from '../../lib/LoggingUtil.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';

const CHECK_INTERVAL_MS = 30_000;
/** Discord errors after which a schedule can never be delivered: unknown channel/guild, missing access/permissions. */
const UNDELIVERABLE_ERRORS = new Set([10003, 10004, 50001, 50013]);
/** Plain-language reason shown in the log for each undeliverable error. */
const UNDELIVERABLE_REASONS: Record<number, string> = {
	10003: 'The channel no longer exists.',
	10004: 'The server is no longer available to the bot.',
	50001: 'The bot no longer has access to the channel.',
	50013: 'The bot is missing the permissions needed to post in the channel.',
};
/** Unknown Member / Unknown User: the creator is no longer in the server. */
const UNKNOWN_MEMBER_ERRORS = new Set([10007, 10013]);

const table = schema.scheduledAnnouncements;
type ScheduledAnnouncement = typeof table.$inferSelect;

/**
 * What already went out for a schedule's current run (keyed by row id). A failed DB update or a
 * container that fails after its ping is retried on the next tick without repeating either.
 */
interface RunProgress {
	runAt: number;
	pinged: boolean;
	/** The log note about a dropped ping was already sent for this run. */
	pingDropLogged: boolean;
	sentAt: number | null;
}

function discordErrorCode(err: unknown): number | null {
	const code = (err as { code?: unknown } | null)?.code;
	return typeof code === 'number' ? code : null;
}

/** The schedule's creator, or null when they are no longer in the server. Other errors are rethrown (retried next tick). */
async function fetchCreator(guild: Guild, userId: string): Promise<GuildMember | null> {
	try {
		return await guild.members.fetch(userId);
	} catch (err) {
		const code = discordErrorCode(err);
		if (code !== null && UNKNOWN_MEMBER_ERRORS.has(code)) return null;
		throw err;
	}
}

@ApplyOptions<Listener.Options>({
	name: 'announcementScheduler',
	event: Events.ClientReady,
	once: true,
})
export class AnnouncementSchedulerListener extends Listener<typeof Events.ClientReady> {
	private readonly progress = new Map<number, RunProgress>();

	public override run(client: Client<true>) {
		let running = false;
		const check = async () => {
			if (running) return;
			running = true;
			try {
				const due = await db
					.select()
					.from(table)
					.where(and(eq(table.active, true), lte(table.nextRunAt, Date.now())));

				// Forget progress for rows that are no longer due (deleted, deactivated or advanced elsewhere).
				const dueIds = new Set(due.map((row) => row.id));
				for (const id of this.progress.keys()) {
					if (!dueIds.has(id)) this.progress.delete(id);
				}

				for (const row of due) {
					await this.deliver(client, row);
				}
			} catch (err) {
				client.logger.error('[AnnouncementScheduler] Error during check:', err);
			} finally {
				running = false;
			}
		};

		void check();
		setInterval(() => void check(), CHECK_INTERVAL_MS);
	}

	private async deliver(client: Client<true>, row: ScheduledAnnouncement) {
		let state = this.progress.get(row.id);
		if (!state || state.runAt !== row.nextRunAt) {
			state = { runAt: row.nextRunAt, pinged: false, pingDropLogged: false, sentAt: null };
			this.progress.set(row.id, state);
		}

		try {
			if (state.sentAt === null) {
				const channel = await client.channels.fetch(row.channelId);
				if (!channel || channel.isDMBased() || !channel.isSendable() || channel.guildId !== row.guildId) {
					await this.deactivate(client, row, 'The channel can no longer receive announcements.');
					return;
				}

				// The creator's authority is re-checked on every run: Manage Server can be lost after creation,
				// and the ping rule depends on their current permissions in this channel.
				const guild = client.guilds.cache.get(row.guildId) ?? channel.guild;
				const creator = await fetchCreator(guild, row.createdBy);
				const authority = checkScheduleAuthority(creator, channel, row.pingType, row.pingId);
				if (!authority.ok) {
					await this.deactivate(client, row, authority.reason);
					return;
				}

				// Ping must be sent as plain content before the CV2 container (can't mix both).
				const ping = authority.pingAllowed ? buildAnnouncementPing(row.guildId, row.pingType, row.pingId) : undefined;
				if (!authority.pingAllowed && !state.pingDropLogged) {
					state.pingDropLogged = true;
					await this.logNote(
						guild,
						'Scheduled Announcement Sent Without Ping',
						Colors.Warning,
						row,
						'The creator no longer has permission to send that ping in the channel, so the announcement was sent without it.',
					);
				}
				if (ping && !state.pinged) {
					await channel.send(ping);
					state.pinged = true;
				}

				const container = buildAnnouncementContainer({
					color: resolveAnnounceColor(row.color),
					heading: row.heading,
					body: row.body,
					footer: `-# Scheduled by ${userMention(row.createdBy)}`,
				});
				// Mentions typed into the body/heading never notify — only the explicit ping option does.
				await channel.send({ components: [container], flags: CV2_FLAG, allowedMentions: { parse: [] } });
				state.sentAt = Date.now();
			}

			// Guarded on the old next_run_at so a run that was already recorded never sends twice.
			const guard = and(eq(table.id, row.id), eq(table.active, true), eq(table.nextRunAt, row.nextRunAt));
			if (row.intervalMs && row.intervalMs > 0) {
				await db
					.update(table)
					.set({ nextRunAt: advanceNextRun(row.nextRunAt, row.intervalMs, Date.now()), lastSentAt: state.sentAt })
					.where(guard);
			} else {
				await db.update(table).set({ active: false, lastSentAt: state.sentAt }).where(guard);
			}
			this.progress.delete(row.id);
		} catch (err) {
			const code = discordErrorCode(err);
			if (code !== null && UNDELIVERABLE_ERRORS.has(code)) {
				// Unknown channel / no access — retrying every 30 s would never succeed.
				await this.deactivate(
					client,
					row,
					`${UNDELIVERABLE_REASONS[code] ?? 'Discord rejected the message.'} (Discord error ${code})`,
				);
			} else {
				// Transient failure — leave the row due so the next tick can retry.
				client.logger.warn(
					`[AnnouncementScheduler] Failed to deliver scheduled announcement ${row.id}; will retry:`,
					err,
				);
			}
		}
	}

	/**
	 * Turn off a schedule that will not be sent (guarded on next_run_at so a concurrent change wins),
	 * then tell staff through the log. `why` is a full sentence naming the reason.
	 */
	private async deactivate(client: Client<true>, row: ScheduledAnnouncement, why: string) {
		client.logger.warn(`[AnnouncementScheduler] Deactivating scheduled announcement ${row.id}: ${why}`);
		this.progress.delete(row.id);
		let changed = false;
		try {
			const result = await db
				.update(table)
				.set({ active: false })
				.where(and(eq(table.id, row.id), eq(table.active, true), eq(table.nextRunAt, row.nextRunAt)));
			changed = Number((result as any)[0]?.affectedRows ?? 0) > 0;
		} catch (err) {
			client.logger.error(`[AnnouncementScheduler] Failed to deactivate scheduled announcement ${row.id}:`, err);
			return;
		}
		// Deleted, edited or already deactivated elsewhere: nothing to report.
		if (!changed) return;

		const guild = client.guilds.cache.get(row.guildId);
		if (!guild) return;
		await this.logNote(guild, 'Scheduled Announcement Deactivated', Colors.Error, row, why);
	}

	/** Send a schedule log entry (only while the logging module is on). Never throws. */
	private async logNote(guild: Guild, title: string, color: number, row: ScheduledAnnouncement, why: string) {
		try {
			if (!(await isModuleEnabled(guild.id, 'logging'))) return;
			await sendLog(
				guild,
				logContainer({
					title,
					color,
					fields: [
						{ name: 'Schedule', value: `\`#${row.id}\`` },
						logFields.channel(row.channelId),
						{ name: 'Created By', value: userMention(row.createdBy) },
						logFields.reason(why),
					],
					timestamp: true,
				}),
			);
		} catch (err) {
			this.container.logger.warn(`[AnnouncementScheduler] Failed to log schedule ${row.id}:`, err);
		}
	}
}
