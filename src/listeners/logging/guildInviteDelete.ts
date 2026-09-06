import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Events, type Invite } from 'discord.js';
import { inviteCache } from '../../lib/InviteUtil.js';

@ApplyOptions<Listener.Options>({
	name: 'inviteDeleteCache',
	event: Events.InviteDelete,
})
export class InviteDeleteListener extends Listener<typeof Events.InviteDelete> {
	public override run(invite: Invite) {
		if (!invite.guild) return;
		inviteCache.get(invite.guild.id)?.delete(invite.code);
	}
}
