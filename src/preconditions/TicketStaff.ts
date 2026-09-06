import { AllFlowsPrecondition } from '@sapphire/framework';
import type { ChatInputCommandInteraction, ContextMenuCommandInteraction, Message } from 'discord.js';
import { PermissionFlagsBits } from 'discord.js';
import { getGuildCategories } from '../lib/TicketManager.js';

/**
 * Precondition: TicketStaff
 *
 * The interaction user must have at least one staff role from ANY ticket
 * category, OR have ManageChannels permission (staff/admins).
 */
export class TicketStaffPrecondition extends AllFlowsPrecondition {
	public override async chatInputRun(interaction: ChatInputCommandInteraction) {
		if (!interaction.inGuild() || !interaction.memberPermissions) {
			return this.error({ message: 'This command can only be used in a server.' });
		}
		const roleIds =
			typeof interaction.member?.roles === 'object' && 'cache' in (interaction.member.roles as object)
				? ([...(interaction.member.roles as { cache: Map<string, unknown> }).cache.keys()] as string[])
				: [];
		return this.checkAsync(interaction.guildId, roleIds, BigInt(interaction.memberPermissions.bitfield));
	}

	public override async contextMenuRun(interaction: ContextMenuCommandInteraction) {
		if (!interaction.inGuild() || !interaction.memberPermissions) {
			return this.error({ message: 'This command can only be used in a server.' });
		}
		const roleIds =
			typeof interaction.member?.roles === 'object' && 'cache' in (interaction.member.roles as object)
				? ([...(interaction.member.roles as { cache: Map<string, unknown> }).cache.keys()] as string[])
				: [];
		return this.checkAsync(interaction.guildId, roleIds, BigInt(interaction.memberPermissions.bitfield));
	}

	public override async messageRun(message: Message) {
		if (!message.inGuild() || !message.member) {
			return this.error({ message: 'This can only be used in a server.' });
		}
		return this.checkAsync(
			message.guild.id,
			message.member.roles.cache.map((r) => r.id),
			BigInt(message.member.permissions.bitfield),
		);
	}

	private async checkAsync(guildId: string, roleIds: string[], perms: bigint) {
		if (
			(perms & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator ||
			(perms & PermissionFlagsBits.ManageChannels) === PermissionFlagsBits.ManageChannels
		) {
			return this.ok();
		}

		const categories = await getGuildCategories(guildId);
		const staffRoleIds = categories.flatMap((c) => c.staffRoleIds);

		return roleIds.some((id) => staffRoleIds.includes(id))
			? this.ok()
			: this.error({ message: 'You must be a ticket staff member to use this command.' });
	}
}

declare module '@sapphire/framework' {
	interface Preconditions {
		TicketStaff: never;
	}
}
