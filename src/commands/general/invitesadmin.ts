import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { MessageFlags, PermissionFlagsBits, TextDisplayBuilder } from 'discord.js';
import { Colors, cv2Reply, errorReply, hint, makeContainer, successReply, warningReply } from '../../lib/components.js';
import { joinLinesCapped } from '../../lib/config/listFormat.js';
import {
	addInviteReward,
	listInviteRewards,
	MAX_REWARD_INVITES,
	removeInviteReward,
	requireInviteTracking,
	resetInviter,
} from '../../lib/InviteTrackingUtil.js';
import { configurableRoleError, fetchBotMember } from '../../lib/RoleSafety.js';

/**
 * Staff invite tools. Split out of `/invites` so the whole command can carry a
 * ManageGuild default permission (Discord can't hide individual subcommands).
 * `requiredUserPermissions` + `Moderation` re-check at runtime, since server
 * admins can override command visibility in Integrations settings.
 */
@ApplyOptions<Subcommand.Options>({
	name: 'invitesadmin',
	description: 'Manage invite rewards and counts (Manage Server only).',
	requiredUserPermissions: [PermissionFlagsBits.ManageGuild],
	preconditions: ['Moderation'],
	subcommands: [
		{ name: 'reward-add', chatInputRun: 'chatInputRewardAdd' },
		{ name: 'reward-remove', chatInputRun: 'chatInputRewardRemove' },
		{ name: 'reward-list', chatInputRun: 'chatInputRewardList' },
		{ name: 'reset', chatInputRun: 'chatInputReset' },
	],
})
export class InvitesAdminCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('invitesadmin')
				.setDescription('Manage invite rewards and counts (Manage Server only).')
				.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
				.addSubcommand((sub) =>
					sub
						.setName('reward-add')
						.setDescription('Give a role to members who reach an invite count.')
						.addIntegerOption((o) =>
							o
								.setName('invites')
								.setDescription('Effective invites needed.')
								.setMinValue(1)
								.setMaxValue(MAX_REWARD_INVITES)
								.setRequired(true),
						)
						.addRoleOption((o) => o.setName('role').setDescription('Role to grant.').setRequired(true)),
				)
				.addSubcommand((sub) =>
					sub
						.setName('reward-remove')
						.setDescription('Remove an invite reward.')
						.addIntegerOption((o) =>
							o
								.setName('invites')
								.setDescription('Invite count of the reward.')
								.setMinValue(1)
								.setMaxValue(MAX_REWARD_INVITES)
								.setRequired(true),
						)
						.addRoleOption((o) => o.setName('role').setDescription('Role of the reward.').setRequired(true)),
				)
				.addSubcommand((sub) => sub.setName('reward-list').setDescription('List the invite rewards.'))
				.addSubcommand((sub) =>
					sub
						.setName('reset')
						.setDescription("Delete everything credited to a member's invites.")
						.addUserOption((o) => o.setName('user').setDescription('The inviter to reset.').setRequired(true)),
				),
		);
	}

	/** Deferred + in guild + Invite Tracking on. Returns the guild ID, or null after replying with an error. */
	private async guard(interaction: Subcommand.ChatInputCommandInteraction): Promise<string | null> {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const guild = await requireInviteTracking(interaction);
		return guild?.id ?? null;
	}

	public async chatInputRewardAdd(interaction: Subcommand.ChatInputCommandInteraction) {
		const guildId = await this.guard(interaction);
		if (!guildId || !interaction.inCachedGuild()) return;

		const invites = interaction.options.getInteger('invites', true);
		const roleOption = interaction.options.getRole('role', true);
		const role = interaction.guild.roles.cache.get(roleOption.id);
		if (!role) return interaction.editReply(errorReply('That role could not be found.'));

		// The bot hands reward roles out on its own, so the invoker must be able to manage the role and
		// it must carry no staff permissions (RoleSafety).
		const problem = configurableRoleError(role, interaction.member, await fetchBotMember(interaction.guild));
		if (problem) return interaction.editReply(errorReply(problem));

		if (!(await addInviteReward(guildId, invites, role.id))) {
			return interaction.editReply(
				warningReply(`<@&${role.id}> is already the reward for **${invites.toLocaleString()}** invites.`),
			);
		}
		return interaction.editReply(
			successReply(`Members who reach **${invites.toLocaleString()}** invites will now receive <@&${role.id}>.`),
		);
	}

	public async chatInputRewardRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		const guildId = await this.guard(interaction);
		if (!guildId) return;

		const invites = interaction.options.getInteger('invites', true);
		const role = interaction.options.getRole('role', true);

		if (!(await removeInviteReward(guildId, invites, role.id))) {
			return interaction.editReply(
				errorReply(`<@&${role.id}> is not a reward for **${invites.toLocaleString()}** invites.`),
			);
		}
		return interaction.editReply(
			successReply(`Removed the <@&${role.id}> reward for **${invites.toLocaleString()}** invites.`),
		);
	}

	public async chatInputRewardList(interaction: Subcommand.ChatInputCommandInteraction) {
		const guildId = await this.guard(interaction);
		if (!guildId) return;

		const rewards = await listInviteRewards(guildId);
		if (rewards.length === 0) {
			return interaction.editReply(
				warningReply('No invite rewards are set up. Add one with `/invitesadmin reward-add`.'),
			);
		}

		const card = makeContainer({ color: Colors.Info, header: 'Invite Rewards' });
		card.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				joinLinesCapped(rewards.map((r) => `<@&${r.roleId}> · **${r.invites.toLocaleString()}** invites`)),
			),
		);
		card.addTextDisplayComponents(
			hint(
				`${rewards.length} reward${rewards.length === 1 ? '' : 's'} · roles are granted automatically when a member reaches the count`,
			),
		);
		return interaction.editReply(cv2Reply(card, true));
	}

	public async chatInputReset(interaction: Subcommand.ChatInputCommandInteraction) {
		const guildId = await this.guard(interaction);
		if (!guildId) return;

		const user = interaction.options.getUser('user', true);
		const removed = await resetInviter(guildId, user.id);
		if (removed === 0) {
			return interaction.editReply(warningReply(`<@${user.id}> has no invite records to reset.`));
		}
		return interaction.editReply(
			successReply(
				`Reset the invites of <@${user.id}> (${removed.toLocaleString()} record${removed === 1 ? '' : 's'} removed).`,
			),
		);
	}
}
