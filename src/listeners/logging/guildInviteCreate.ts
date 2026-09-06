import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Events, type Invite } from 'discord.js';
import { inviteCache } from '../../lib/InviteUtil.js';

@ApplyOptions<Listener.Options>({
	name: 'inviteCreateCache',
	event: Events.InviteCreate,
})
export class InviteCreateListener extends Listener<typeof Events.InviteCreate> {
	public override run(invite: Invite) {
		if (!invite.guild) return;
		const map = inviteCache.get(invite.guild.id) ?? new Map<string, number>();
		map.set(invite.code, invite.uses ?? 0);
		inviteCache.set(invite.guild.id, map);
	}
}
