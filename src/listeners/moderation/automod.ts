import { Listener } from '@sapphire/framework';
import type { Message } from 'discord.js';
import { runAutomod } from '../../lib/AutomodUtil.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';

export class AutomodMessageCreateListener extends Listener {
	public constructor(context: Listener.LoaderContext) {
		// Explicit, unique name: pieces default to the file basename, and same-named pieces unload each other.
		super(context, { name: 'automodMessageCreate', event: 'messageCreate' });
	}

	public async run(message: Message) {
		if (message.author.bot || !message.inGuild()) return;
		if (!(await isModuleEnabled(message.guildId, 'automod'))) return;
		await runAutomod(message as Message<true>);
	}
}
