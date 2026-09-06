import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Events, type GuildMember } from 'discord.js';
import { updateStatsChannels } from '../../lib/StatsChannelUtil.js';

// Debounce map: guildId → timeout
const pending = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleUpdate(guild: import('discord.js').Guild) {
	const existing = pending.get(guild.id);
	if (existing) clearTimeout(existing);
	pending.set(
		guild.id,
		setTimeout(() => {
			pending.delete(guild.id);
			updateStatsChannels(guild).catch(() => null);
		}, 5000),
	);
}

@ApplyOptions<Listener.Options>({
	name: 'statsChannelMemberAdd',
	event: Events.GuildMemberAdd,
})
export class StatsChannelMemberAddListener extends Listener<typeof Events.GuildMemberAdd> {
	public override run(member: GuildMember) {
		scheduleUpdate(member.guild);
	}
}

@ApplyOptions<Listener.Options>({
	name: 'statsChannelMemberRemove',
	event: Events.GuildMemberRemove,
})
export class StatsChannelMemberRemoveListener extends Listener<typeof Events.GuildMemberRemove> {
	public override run(member: GuildMember | import('discord.js').PartialGuildMember) {
		if (member.guild) scheduleUpdate(member.guild);
	}
}
