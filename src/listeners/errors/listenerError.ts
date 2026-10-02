import { ApplyOptions } from '@sapphire/decorators';
import { Events, Listener, type ListenerErrorPayload } from '@sapphire/framework';

/**
 * Gracefully handle errors thrown by generic listeners (e.g. InteractionCreate).
 *
 * - Stale interactions / deleted targets (10062, 10015, 40060, 10008, 10003) — downgraded to debug noise.
 * - Everything else — logged as an error.
 *
 * Sapphire's payload only carries the failing `piece` (not the event arguments), so the interaction
 * isn't reachable here: listeners that must answer the user catch their own errors.
 */
@ApplyOptions<Listener.Options>({
	name: 'listenerError',
	event: Events.ListenerError,
})
export class ListenerErrorListener extends Listener<typeof Events.ListenerError> {
	public override run(error: unknown, context: ListenerErrorPayload) {
		// 10062 Unknown Interaction — stale (bot restarted while interaction was pending)
		// 10015 Unknown Webhook / 40060 Already acknowledged — similar stale scenarios
		// 10008 Unknown Message / 10003 Unknown Channel
		if (isRestError(error, [10062, 10015, 40060, 10008, 10003])) {
			this.container.logger.debug(
				`[${context.piece.name}] Stale interaction discarded (code ${(error as { code: number }).code}).`,
			);
			return;
		}

		this.container.logger.error(`Encountered error in listener "${context.piece.name}":`, error);
	}
}

function isRestError(err: unknown, codes: number[]): boolean {
	if (typeof err !== 'object' || err === null) return false;
	const code = (err as Record<string, unknown>).code;
	return typeof code === 'number' && codes.includes(code);
}
