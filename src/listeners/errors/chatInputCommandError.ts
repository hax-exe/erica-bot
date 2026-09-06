import { ApplyOptions } from '@sapphire/decorators';
import { type ChatInputCommandErrorPayload, Listener } from '@sapphire/framework';
import { MessageFlags, TextDisplayBuilder } from 'discord.js';
import { Colors, CV2_FLAG, makeContainer } from '../../lib/components.js';

/**
 * Gracefully handle errors thrown by chat-input command handlers.
 *
 * - Stale interactions (10062, 10015, 40060) — downgraded to debug noise.
 * - Everything else — logged as error + user gets an ephemeral error reply.
 */
@ApplyOptions<Listener.Options>({
	name: 'chatInputCommandError',
	event: 'chatInputCommandError' as const,
})
export class ChatInputCommandErrorListener extends Listener {
	public override async run(error: unknown, { command, interaction }: ChatInputCommandErrorPayload) {
		// 10062 Unknown Interaction — stale (bot restarted while interaction was pending)
		// 10015 Unknown Webhook / 40060 Already acknowledged — similar stale scenarios
		if (isRestError(error, [10062, 10015, 40060])) {
			this.container.logger.debug(
				`[${command.name}] Stale interaction discarded (code ${(error as { code: number }).code}).`,
			);
			return;
		}

		// Log the actual error so it shows up in the terminal
		this.container.logger.error(`Encountered error on chat input command "${command.name}":`, error);

		// Try to inform the user — silently ignore if we can't reply
		const container = makeContainer({ color: Colors.Error });
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent('❌ An unexpected error occurred. Please try again.'),
		);

		try {
			if (interaction.deferred || interaction.replied) {
				// biome-ignore lint/suspicious/noExplicitAny: Discord.js CV2 flag type gap
				await interaction.editReply({ components: [container], flags: CV2_FLAG as any });
			} else {
				// biome-ignore lint/suspicious/noExplicitAny: Discord.js CV2 flag type gap
				await interaction.reply({ components: [container], flags: (CV2_FLAG | MessageFlags.Ephemeral) as any });
			}
		} catch {
			// Interaction already timed out — nothing we can do
		}
	}
}

function isRestError(err: unknown, codes: number[]): boolean {
	if (typeof err !== 'object' || err === null) return false;
	const code = (err as Record<string, unknown>).code;
	return typeof code === 'number' && codes.includes(code);
}
