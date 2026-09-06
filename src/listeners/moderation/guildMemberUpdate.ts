import { ApplyOptions } from '@sapphire/decorators';
import { Events, Listener } from '@sapphire/framework';
import type { GuildMember } from 'discord.js';
import { pendingTimeoutBypass } from '../../lib/ModerationUtil.js';

/**
 * Timeout / untimeout case creation is intentionally NOT done here.
 *
 * - Bot-initiated timeouts set `pendingTimeoutBypass` and are logged by the command.
 * - Manual Discord UI timeouts/untimeouts are logged via the audit-log listener
 *   (with the real moderator), which avoids duplicate SYSTEM cases.
 * - Natural timeout expiry is logged by `untimeoutScheduler` for infractions that
 *   have a recorded duration.
 */
@ApplyOptions<Listener.Options>({
	event: Events.GuildMemberUpdate,
})
export class UserListener extends Listener {
	public async run(oldMember: GuildMember, newMember: GuildMember) {
		const oldTimeout = oldMember.communicationDisabledUntilTimestamp ?? 0;
		const newTimeout = newMember.communicationDisabledUntilTimestamp ?? 0;

		if (oldTimeout === newTimeout) return;

		// Consume the bypass marker so it doesn't leak across unrelated updates
		if (pendingTimeoutBypass.has(newMember.id)) {
			pendingTimeoutBypass.delete(newMember.id);
		}
	}
}
