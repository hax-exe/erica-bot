import { ApplyOptions } from '@sapphire/decorators';
import { AllFlowsPrecondition } from '@sapphire/framework';
import type { ChatInputCommandInteraction, ContextMenuCommandInteraction, Message } from 'discord.js';
import { formatBlacklistDenial, getBotBlacklistEntry } from '../lib/BlacklistUtil.js';

/**
 * Precondition: NotBlacklisted
 *
 * Global (position set) — runs on every slash / context-menu / message command.
 * Component & modal interactions are covered by `blacklistInteractionGate` + per-listener checks.
 */
@ApplyOptions<AllFlowsPrecondition.Options>({
	name: 'NotBlacklisted',
	position: 10,
})
export class NotBlacklistedPrecondition extends AllFlowsPrecondition {
	public override async chatInputRun(interaction: ChatInputCommandInteraction) {
		return this.checkBlacklist(interaction.user.id);
	}

	public override async contextMenuRun(interaction: ContextMenuCommandInteraction) {
		return this.checkBlacklist(interaction.user.id);
	}

	public override async messageRun(message: Message) {
		return this.checkBlacklist(message.author.id);
	}

	private async checkBlacklist(userId: string) {
		const entry = await getBotBlacklistEntry(userId);
		if (entry.blocked) {
			return this.error({
				message: formatBlacklistDenial(entry.reason),
			});
		}
		return this.ok();
	}
}

declare module '@sapphire/framework' {
	interface Preconditions {
		NotBlacklisted: never;
	}
}
