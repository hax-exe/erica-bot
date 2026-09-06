import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { ChannelType, PermissionFlagsBits } from 'discord.js';

@ApplyOptions<Subcommand.Options>({
	name: 'reactionrole',
	description: 'Manage role panels (select menus or buttons).',
	preconditions: ['Moderation'],
	subcommands: [
		{ name: 'panel', chatInputRun: 'chatInputPanel' },
		{ name: 'add', chatInputRun: 'chatInputAdd' },
		{ name: 'remove', chatInputRun: 'chatInputRemove' },
		{ name: 'list', chatInputRun: 'chatInputList' },
		{ name: 'delete', chatInputRun: 'chatInputDelete' },
	],
})
export class ReactionRoleCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('reactionrole')
				.setDescription('Manage role panels (select menus or buttons).')
				.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
				.addSubcommand((sub) =>
					sub
						.setName('panel')
						.setDescription('Create a new role panel in a channel.')
						.addChannelOption((o) =>
							o
								.setName('channel')
								.setDescription('Channel to post the panel in.')
								.addChannelTypes(ChannelType.GuildText)
								.setRequired(true),
						)
						.addStringOption((o) =>
							o
								.setName('title')
								.setDescription('Panel title (default: Role Selection).')
								.setMaxLength(80)
								.setRequired(false),
						)
						.addStringOption((o) =>
							o
								.setName('description')
								.setDescription('Optional description shown on the panel.')
								.setMaxLength(300)
								.setRequired(false),
						)
						.addStringOption((o) =>
							o
								.setName('mode')
								.setDescription('Display mode.')
								.setRequired(false)
								.addChoices(
									{ name: 'Select menu (dropdown)', value: 'select' },
									{ name: 'Buttons (one per role)', value: 'buttons' },
								),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('add')
						.setDescription('Add a role option to a panel.')
						.addIntegerOption((o) => o.setName('panel_id').setDescription('Panel ID.').setRequired(true).setMinValue(1))
						.addRoleOption((o) => o.setName('role').setDescription('Role to assign.').setRequired(true))
						.addStringOption((o) =>
							o
								.setName('label')
								.setDescription('Label shown on the button/option.')
								.setMaxLength(100)
								.setRequired(true),
						)
						.addStringOption((o) =>
							o
								.setName('description')
								.setDescription('Short description (select menu only).')
								.setMaxLength(100)
								.setRequired(false),
						)
						.addStringOption((o) =>
							o.setName('emoji').setDescription('Emoji shown next to the label.').setRequired(false),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('remove')
						.setDescription('Remove a role option from a panel.')
						.addIntegerOption((o) => o.setName('panel_id').setDescription('Panel ID.').setRequired(true).setMinValue(1))
						.addRoleOption((o) => o.setName('role').setDescription('Role to remove.').setRequired(true)),
				)
				.addSubcommand((sub) => sub.setName('list').setDescription('List all role panels in this server.'))
				.addSubcommand((sub) =>
					sub
						.setName('delete')
						.setDescription('Delete a panel and its roles.')
						.addIntegerOption((o) =>
							o.setName('panel_id').setDescription('Panel ID to delete.').setRequired(true).setMinValue(1),
						),
				),
		);
	}

	public async chatInputPanel(interaction: Subcommand.ChatInputCommandInteraction) {
		const { ReactionRoleHandler } = await import('../../lib/config/handlers/reactionrole.js');
		return new ReactionRoleHandler().chatInputPanel(interaction);
	}
	public async chatInputAdd(interaction: Subcommand.ChatInputCommandInteraction) {
		const { ReactionRoleHandler } = await import('../../lib/config/handlers/reactionrole.js');
		return new ReactionRoleHandler().chatInputAdd(interaction);
	}
	public async chatInputRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		const { ReactionRoleHandler } = await import('../../lib/config/handlers/reactionrole.js');
		return new ReactionRoleHandler().chatInputRemove(interaction);
	}
	public async chatInputList(interaction: Subcommand.ChatInputCommandInteraction) {
		const { ReactionRoleHandler } = await import('../../lib/config/handlers/reactionrole.js');
		return new ReactionRoleHandler().chatInputList(interaction);
	}
	public async chatInputDelete(interaction: Subcommand.ChatInputCommandInteraction) {
		const { ReactionRoleHandler } = await import('../../lib/config/handlers/reactionrole.js');
		return new ReactionRoleHandler().chatInputDelete(interaction);
	}
}
