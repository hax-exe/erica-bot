import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { ActivityType, Events, type Presence } from 'discord.js';
import { Colors, logContainer } from '../../lib/components.js';
import { LogEmpty, logFields, sendLog } from '../../lib/LoggingUtil.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';

// HIGH VOLUME — fires for every presence change across the entire guild.
// Requires the GUILD_PRESENCES privileged intent to be enabled.

@ApplyOptions<Listener.Options>({
	name: 'presenceUpdateLogging',
	event: Events.PresenceUpdate,
})
export class PresenceUpdateListener extends Listener<typeof Events.PresenceUpdate> {
	public override async run(oldPresence: Presence | null, newPresence: Presence) {
		const guild = newPresence.guild;
		if (!guild) return;

		// When oldPresence is null Discord didn't cache the previous state —
		// we can't know what changed, so logging would be unreliable noise.
		if (!oldPresence) return;

		// Resolve member; fetch from API if not in cache.
		const member = newPresence.member ?? (await guild.members.fetch(newPresence.userId).catch(() => null));
		if (!member || member.user.bot) return;

		if (!(await isModuleEnabled(guild.id, 'logging'))) return;

		const userField = logFields.user(newPresence.userId);

		// Online/idle/dnd/offline status change
		if (oldPresence.status !== newPresence.status) {
			await sendLog(
				guild,
				logContainer({
					title: 'Presence Updated',
					color: Colors.Neutral,
					fields: [
						userField,
						{ name: 'Old Status', value: oldPresence.status },
						{ name: 'New Status', value: newPresence.status },
					],
					timestamp: true,
					targetUser: member.user,
				}),
			).catch(() => null);
		}

		// Custom status text change
		const oldCustom = oldPresence.activities.find((a) => a.type === ActivityType.Custom);
		const newCustom = newPresence.activities.find((a) => a.type === ActivityType.Custom);
		const oldState = oldCustom?.state ?? null;
		const newState = newCustom?.state ?? null;
		if (oldState !== newState) {
			await sendLog(
				guild,
				logContainer({
					title: 'Custom Status Updated',
					color: Colors.Neutral,
					fields: [userField, logFields.before(oldState ?? LogEmpty.none), logFields.after(newState ?? LogEmpty.none)],
					timestamp: true,
					targetUser: member.user,
				}),
			).catch(() => null);
		}

		// Rich-presence activity change — compare by name+type+details to avoid phantom diffs.
		const oldActivity = oldPresence.activities.find((a) => a.type !== ActivityType.Custom);
		const newActivity = newPresence.activities.find((a) => a.type !== ActivityType.Custom);
		const activityKey = (a: typeof oldActivity | undefined) => (a ? `${a.type}|${a.name}|${a.details ?? ''}` : null);

		if (activityKey(oldActivity) !== activityKey(newActivity) && newActivity) {
			const typeLabel = ActivityType[newActivity.type] ?? 'Activity';
			await sendLog(
				guild,
				logContainer({
					title: `Activity Updated · ${typeLabel}`,
					color: Colors.Neutral,
					fields: [
						userField,
						{ name: 'Activity', value: newActivity.name },
						...(newActivity.details ? [{ name: 'Details', value: newActivity.details }] : []),
						...(newActivity.url ? [{ name: 'URL', value: newActivity.url }] : []),
					],
					timestamp: true,
					targetUser: member.user,
				}),
			).catch(() => null);
		}
	}
}
