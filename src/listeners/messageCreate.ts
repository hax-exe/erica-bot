import { ApplyOptions } from '@sapphire/decorators';
import { Events, Listener } from '@sapphire/framework';
import type { Message } from 'discord.js';
import { runAutomod } from '../lib/AutomodUtil.js';

@ApplyOptions<Listener.Options>({
	name: 'automodMessageListener',
	event: Events.MessageCreate,
})
export class UserListener extends Listener {
	public override async run(message: Message) {
		// Only process messages in guilds
		if (!message.guild || message.author.bot) return;

		// Trigger the AutoMod utility
		await runAutomod(message as Message<true>);
	}
}
