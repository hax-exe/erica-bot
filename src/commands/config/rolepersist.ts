import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { MessageFlags, PermissionFlagsBits, TextDisplayBuilder } from 'discord.js';
import { eq } from 'drizzle-orm';
import {
	Colors,
	cv2Reply,
	errorReply,
	fields,
	hint,
	makeContainer,
	successReply,
	warningReply,
} from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';
import {
	deleteSnapshot,
	getRolePersistSettings,
	setRestoreNickname,
	updateIgnoredRoles,
} from '../../lib/RolePersistUtil.js';

type ModuleState = 'on' | 'guild-off' | 'global-off';

/** Whether role persistence can run here: on, off for this guild, or killed by the global module switch. */
async function getModuleState(guildId: string): Promise<ModuleState> {
	if (await isModuleEnabled(guildId, 'rolePersistence')) return 'on';
	const globalRow = await db.query.globalModules.findFirst({ where: eq(schema.globalModules.id, 1) });
	return globalRow?.rolePersistence === false ? 'global-off' : 'guild-off';
}

const GUILD_OFF_HINT =
	'The **Role Persistence** module is off, so nothing is saved or restored. Turn it on with `/module enable`.';
const GLOBAL_OFF_HINT = 'Role Persistence is disabled globally by the bot owner, so nothing is saved or restored.';

function moduleHint(state: ModuleState): string | null {
	if (state === 'guild-off') return GUILD_OFF_HINT;
	if (state === 'global-off') return GLOBAL_OFF_HINT;
	return null;
}

/** Append the "module is off" hint to a confirmation, so staff are not left wondering why nothing happens. */
async function withModuleHint(guildId: string, message: string): Promise<string> {
	const note = moduleHint(await getModuleState(guildId));
	return note ? `${message}\n-# ${note}` : message;
}

@ApplyOptions<Subcommand.Options>({
	name: 'rolepersist',
	description: 'Restore roles to members who leave and rejoin.',
	requiredUserPermissions: [PermissionFlagsBits.ManageGuild],
	preconditions: ['Moderation'],
	subcommands: [
		{ name: 'view', chatInputRun: 'chatInputView' },
		{ name: 'ignore-add', chatInputRun: 'chatInputIgnoreAdd' },
		{ name: 'ignore-remove', chatInputRun: 'chatInputIgnoreRemove' },
		{ name: 'nickname', chatInputRun: 'chatInputNickname' },
		{ name: 'clear', chatInputRun: 'chatInputClear' },
	],
})
export class RolePersistCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('rolepersist')
				.setDescription('Restore roles to members who leave and rejoin.')
				.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
				.addSubcommand((sub) =>
					sub.setName('view').setDescription('Show the role persistence settings and ignored roles.'),
				)
				.addSubcommand((sub) =>
					sub
						.setName('ignore-add')
						.setDescription('Never save or restore this role.')
						.addRoleOption((o) => o.setName('role').setDescription('Role to ignore.').setRequired(true)),
				)
				.addSubcommand((sub) =>
					sub
						.setName('ignore-remove')
						.setDescription('Stop ignoring a role.')
						.addRoleOption((o) => o.setName('role').setDescription('Role to stop ignoring.').setRequired(true)),
				)
				.addSubcommand((sub) =>
					sub
						.setName('nickname')
						.setDescription('Choose whether a returning member also gets their old nickname back.')
						.addBooleanOption((o) =>
							o.setName('enabled').setDescription('Restore nicknames on rejoin.').setRequired(true),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('clear')
						.setDescription("Delete a user's saved roles so nothing is restored when they rejoin.")
						.addUserOption((o) => o.setName('user').setDescription('The user to clear.').setRequired(true)),
				),
		);
	}

	public async chatInputView(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const [settings, state] = await Promise.all([
			getRolePersistSettings(interaction.guildId),
			getModuleState(interaction.guildId),
		]);

		const moduleLabel = state === 'on' ? 'On' : state === 'global-off' ? 'Off (disabled globally)' : 'Off';
		const ignored = settings.ignoredRoleIds.length
			? settings.ignoredRoleIds
					.map((id) => (interaction.guild.roles.cache.has(id) ? `<@&${id}>` : `\`${id}\` (deleted)`))
					.join(', ')
			: 'None';

		const container = makeContainer({ color: Colors.Info, header: 'Role Persistence' });
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				fields([
					['Module', moduleLabel],
					['Restore nickname', settings.restoreNickname ? 'Yes' : 'No'],
					['Ignored roles', ignored],
				]),
			),
		);
		const notes = [
			'Roles are saved when a member leaves and given back when they rejoin.',
			'@everyone, managed, ignored, staff (Administrator, Manage Server, Ban Members…) and roles above mine are never restored.',
		];
		const moduleNote = moduleHint(state);
		container.addTextDisplayComponents(hint(...(moduleNote ? [moduleNote, ...notes] : notes)));

		return interaction.editReply(cv2Reply(container, true));
	}

	public async chatInputIgnoreAdd(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const role = interaction.options.getRole('role', true);
		if (role.id === interaction.guildId) return interaction.editReply(errorReply('@everyone is never saved.'));
		if (role.managed) {
			return interaction.editReply(
				errorReply('Managed (integration or bot) roles are never saved, so there is nothing to ignore.'),
			);
		}

		const { before } = await updateIgnoredRoles(interaction.guildId, (current) => {
			const live = current.filter((id) => interaction.guild.roles.cache.has(id));
			return live.includes(role.id) ? live : [...live, role.id];
		});
		if (before.includes(role.id)) {
			return interaction.editReply(warningReply(`<@&${role.id}> is already ignored.`));
		}

		return interaction.editReply(
			successReply(await withModuleHint(interaction.guildId, `<@&${role.id}> will no longer be saved or restored.`)),
		);
	}

	public async chatInputIgnoreRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const role = interaction.options.getRole('role', true);

		// Deleted roles can never be picked in the option, so drop them from the list while we are here.
		const { before } = await updateIgnoredRoles(interaction.guildId, (current) =>
			current.filter((id) => id !== role.id && interaction.guild.roles.cache.has(id)),
		);
		if (!before.includes(role.id)) {
			return interaction.editReply(warningReply(`<@&${role.id}> is not on the ignore list.`));
		}

		return interaction.editReply(
			successReply(await withModuleHint(interaction.guildId, `<@&${role.id}> is no longer ignored.`)),
		);
	}

	public async chatInputNickname(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const enabled = interaction.options.getBoolean('enabled', true);
		await setRestoreNickname(interaction.guildId, enabled);

		return interaction.editReply(
			successReply(
				await withModuleHint(
					interaction.guildId,
					enabled
						? 'Returning members will get their old nickname back.'
						: 'Nicknames will no longer be restored when members rejoin.',
				),
			),
		);
	}

	public async chatInputClear(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const user = interaction.options.getUser('user', true);
		const existed = await deleteSnapshot(interaction.guildId, user.id);
		if (!existed) return interaction.editReply(warningReply(`No saved roles found for <@${user.id}>.`));

		return interaction.editReply(
			successReply(`Cleared the saved roles for <@${user.id}>. Nothing will be restored if they rejoin.`),
		);
	}
}
