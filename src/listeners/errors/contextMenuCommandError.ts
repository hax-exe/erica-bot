import { ApplyOptions } from '@sapphire/decorators';
import { type ContextMenuCommandErrorPayload, Listener } from '@sapphire/framework';
import { MessageFlags, TextDisplayBuilder } from 'discord.js';
import { Colors, CV2_FLAG, makeContainer } from '../../lib/components.js';

@ApplyOptions<Listener.Options>({
	name: 'contextMenuCommandError',
	event: 'contextMenuCommandError' as const,
})
export class ContextMenuCommandErrorListener extends Listener {
	public override async run(error: unknown, { command, interaction }: ContextMenuCommandErrorPayload) {
		if (isRestError(error, [10062, 10015, 40060])) {
			this.container.logger.debug(
				`[${command.name}] Stale context menu interaction discarded (code ${(error as { code: number }).code}).`,
			);
			return;
		}

		this.container.logger.error(`Encountered error on context menu command "${command.name}":`, error);

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
			// Interaction already timed out
		}
	}
}

function isRestError(err: unknown, codes: number[]): boolean {
	if (typeof err !== 'object' || err === null) return false;
	const code = (err as Record<string, unknown>).code;
	return typeof code === 'number' && codes.includes(code);
}
