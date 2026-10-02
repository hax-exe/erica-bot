import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { type ChatInputSubcommandErrorPayload, SubcommandPluginEvents } from '@sapphire/plugin-subcommands';
import { MessageFlags, TextDisplayBuilder } from 'discord.js';
import { Colors, CV2_FLAG, makeContainer } from '../../lib/components.js';

/**
 * Tell the user when a subcommand handler throws.
 *
 * Errors inside `Subcommand` handlers are emitted as `chatInputSubcommandError` (not
 * `chatInputCommandError`), and the plugin's built-in listener only logs them — without this,
 * the deferred reply would stay on "thinking…" forever. Logging is left to that built-in listener.
 *
 * - Stale interactions (10062, 10015, 40060) — silently discarded.
 * - Everything else — the user gets an ephemeral error reply.
 */
@ApplyOptions<Listener.Options>({
	name: 'chatInputSubcommandError',
	event: SubcommandPluginEvents.ChatInputSubcommandError,
})
export class ChatInputSubcommandErrorListener extends Listener {
	public override async run(error: unknown, { interaction }: ChatInputSubcommandErrorPayload) {
		if (isRestError(error, [10062, 10015, 40060])) return;

		const container = makeContainer({ color: Colors.Error });
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent('❌ An unexpected error occurred. Please try again.'),
		);

		try {
			if (interaction.deferred || interaction.replied) {
				await interaction.editReply({ components: [container], flags: CV2_FLAG as any });
			} else {
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
