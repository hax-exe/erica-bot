import { ApplyOptions } from '@sapphire/decorators';
import { AllFlowsPrecondition } from '@sapphire/framework';
import type { ChatInputCommandInteraction, ContextMenuCommandInteraction, Message } from 'discord.js';

/**
 * Precondition: BotAdmin
 *
 * Only users listed in the BOT_OWNER_IDS environment variable (comma-separated
 * Discord user IDs) may pass this precondition.
 *
 * Apply this to any command that should be restricted to the bot's admins
 * (e.g. /blacklist).
 */
@ApplyOptions<AllFlowsPrecondition.Options>({
	name: 'BotAdmin',
})
export class BotAdminPrecondition extends AllFlowsPrecondition {
	private get ownerIds(): Set<string> {
		const raw = process.env.BOT_OWNER_IDS ?? '';
		return new Set(
			raw
				.split(',')
				.map((id) => id.trim())
				.filter(Boolean),
		);
	}

	public override chatInputRun(interaction: ChatInputCommandInteraction) {
		return this.check(interaction.user.id);
	}

	public override contextMenuRun(interaction: ContextMenuCommandInteraction) {
		return this.check(interaction.user.id);
	}

	public override messageRun(message: Message) {
		return this.check(message.author.id);
	}

	private check(userId: string) {
		return this.ownerIds.has(userId) ? this.ok() : this.error({ message: 'Only bot admins can use this command.' });
	}
}

declare module '@sapphire/framework' {
	interface Preconditions {
		BotAdmin: never;
	}
}
