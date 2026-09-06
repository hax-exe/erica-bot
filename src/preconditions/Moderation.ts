import { AllFlowsPrecondition } from '@sapphire/framework';
import {
	type ChatInputCommandInteraction,
	type ContextMenuCommandInteraction,
	type Message,
	PermissionFlagsBits,
} from 'discord.js';

/**
 * Precondition: Moderation
 *
 * The interaction user must have at least one of the following to use
 * moderation commands:
 *   – ManageGuild permission, OR
 *   – KickMembers permission, OR
 *   – BanMembers permission
 *
 * These are intentionally lenient so partial mods can still use kick without ban.
 * Adjust to a single flag (e.g. ManageGuild only) if desired.
 */
export class ModerationPrecondition extends AllFlowsPrecondition {
	public override chatInputRun(interaction: ChatInputCommandInteraction) {
		return this.checkPermissions(interaction);
	}

	public override contextMenuRun(interaction: ContextMenuCommandInteraction) {
		return this.checkPermissions(interaction);
	}

	public override messageRun(message: Message) {
		if (!message.inGuild()) return this.error({ message: 'This can only be used in a server.' });
		const member = message.member;
		if (!member) return this.error({ message: 'Could not resolve member.' });
		return this.hasModerationPerms(BigInt(member.permissions.bitfield))
			? this.ok()
			: this.error({ message: 'You do not have permission to use moderation commands.' });
	}

	private checkPermissions(
		interaction: ChatInputCommandInteraction | ContextMenuCommandInteraction,
	): ReturnType<AllFlowsPrecondition['ok']> | ReturnType<AllFlowsPrecondition['error']> {
		if (!interaction.inGuild() || !interaction.memberPermissions) {
			return this.error({ message: 'This command can only be used in a server.' });
		}
		return this.hasModerationPerms(BigInt(interaction.memberPermissions.bitfield))
			? this.ok()
			: this.error({ message: 'You do not have permission to use moderation commands.' });
	}

	private hasModerationPerms(perms: bigint): boolean {
		// Admins bypass everything
		if ((perms & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator) return true;
		// Any one of these suffices
		const modPerms =
			PermissionFlagsBits.ManageGuild |
			PermissionFlagsBits.KickMembers |
			PermissionFlagsBits.BanMembers |
			PermissionFlagsBits.ModerateMembers;
		return (perms & modPerms) !== 0n;
	}
}

declare module '@sapphire/framework' {
	interface Preconditions {
		Moderation: never;
	}
}
