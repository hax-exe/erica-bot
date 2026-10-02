import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';
import { errorReply } from './components.js';

/**
 * Ensures the user pressing a component is the one it was issued to.
 * Replies ephemerally and returns false when they differ.
 */
export async function requireComponentOwner(
	interaction: ButtonInteraction | StringSelectMenuInteraction,
	ownerId: string | undefined,
): Promise<boolean> {
	if (ownerId && interaction.user.id === ownerId) return true;
	try {
		// errorReply is already CV2 + ephemeral; overriding flags would drop the CV2 bit.
		await interaction.reply(errorReply("This isn't yours.") as any);
	} catch (err: any) {
		if (err?.code !== 10062 && err?.code !== 40060) throw err;
	}
	return false;
}
