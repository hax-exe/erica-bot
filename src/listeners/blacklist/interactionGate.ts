import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Events, type Interaction } from 'discord.js';
import { rejectBlacklistedInteraction } from '../../lib/BlacklistUtil.js';

/**
 * Blocks blacklisted users from buttons, selects, modals, and autocomplete.
 * Slash / context-menu commands are handled by the NotBlacklisted precondition.
 */
@ApplyOptions<Listener.Options>({
	name: 'blacklistInteractionGate',
	event: Events.InteractionCreate,
})
export class BlacklistInteractionGateListener extends Listener<typeof Events.InteractionCreate> {
	public override async run(interaction: Interaction) {
		if (interaction.isChatInputCommand() || interaction.isContextMenuCommand()) return;
		await rejectBlacklistedInteraction(interaction);
	}
}
