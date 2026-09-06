import { ApplyOptions } from '@sapphire/decorators';
import { Events, Listener, type ListenerErrorPayload } from '@sapphire/framework';
import { type Interaction, MessageFlags, TextDisplayBuilder } from 'discord.js';
import { Colors, CV2_FLAG, makeContainer } from '../../lib/components.js';

/**
 * Gracefully handle errors thrown by generic listeners (e.g. InteractionCreate).
 *
 * - Stale interactions (10062, 10015, 40060) — downgraded to debug noise.
 * - Everything else — logged as error + user gets an ephemeral error reply.
 */
@ApplyOptions<Listener.Options>({
	name: 'listenerError',
	event: Events.ListenerError,
})
export class ListenerErrorListener extends Listener<typeof Events.ListenerError> {
	public override async run(error: unknown, context: ListenerErrorPayload) {
		// 10062 Unknown Interaction — stale (bot restarted while interaction was pending)
		// 10015 Unknown Webhook / 40060 Already acknowledged — similar stale scenarios
		// 10008 Unknown Message / 10003 Unknown Channel
		if (isRestError(error, [10062, 10015, 40060, 10008, 10003])) {
			this.container.logger.debug(
				`[${context.piece.name}] Stale interaction discarded (code ${(error as { code: number }).code}).`,
			);
			return;
		}

		// Log the actual error so it shows up in the terminal
		this.container.logger.error(`Encountered error in listener "${context.piece.name}":`, error);

		// If this was an InteractionCreate event, try to inform the user
		if (
			context.piece.name.toLowerCase().includes('interaction') ||
			context.piece.name.toLowerCase().includes('button')
		) {
			try {
				// We have to extract the interaction from the parameters array (first arg for InteractionCreate)
				// biome-ignore lint/suspicious/noExplicitAny: unknown context args
				const interaction = (context as any)?.parameters?.[0] as Interaction;
				if (interaction && interaction.isRepliable()) {
					const container = makeContainer({ color: Colors.Error });
					container.addTextDisplayComponents(
						new TextDisplayBuilder().setContent('❌ An unexpected error occurred. Please try again.'),
					);

					if (interaction.deferred || interaction.replied) {
						// biome-ignore lint/suspicious/noExplicitAny: Discord.js CV2 flag type gap
						await interaction.editReply({ components: [container], flags: CV2_FLAG as any });
					} else {
						// biome-ignore lint/suspicious/noExplicitAny: Discord.js CV2 flag type gap
						await interaction.reply({ components: [container], flags: (CV2_FLAG | MessageFlags.Ephemeral) as any });
					}
				}
			} catch {
				// Interaction already timed out — nothing we can do
			}
		}
	}
}

function isRestError(err: unknown, codes: number[]): boolean {
	if (typeof err !== 'object' || err === null) return false;
	const code = (err as Record<string, unknown>).code;
	return typeof code === 'number' && codes.includes(code);
}
