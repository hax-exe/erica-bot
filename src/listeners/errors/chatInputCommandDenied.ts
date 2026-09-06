import { ApplyOptions } from '@sapphire/decorators';
import { type ChatInputCommandDeniedPayload, Listener, type UserError } from '@sapphire/framework';
import { MessageFlags } from 'discord.js';
import { errorReply } from '../../lib/components.js';

@ApplyOptions<Listener.Options>({
	name: 'chatInputCommandDenied',
	event: 'chatInputCommandDenied',
})
export class ChatInputCommandDeniedListener extends Listener {
	public override async run(error: UserError, { interaction }: ChatInputCommandDeniedPayload) {
		const msg = error.message || 'You do not have permission to use this command.';
		if (interaction.deferred || interaction.replied) {
			return interaction.editReply(errorReply(msg));
		}
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		return interaction.editReply(errorReply(msg));
	}
}
