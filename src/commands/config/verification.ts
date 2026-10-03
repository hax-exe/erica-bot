import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { ChannelType, MessageFlags, PermissionFlagsBits, TextDisplayBuilder } from 'discord.js';
import {
	Colors,
	CV2_FLAG,
	errorReply,
	fields,
	hint,
	makeContainer,
	spacer,
	successReply,
	warningReply,
} from '../../lib/components.js';
import { setModule } from '../../lib/ModuleUtil.js';
import { configurableRoleError, fetchBotMember } from '../../lib/RoleSafety.js';
import {
	buildVerificationPanel,
	getVerificationModuleState,
	getVerificationSettings,
	upsertVerificationSettings,
	type VerificationSettings,
	type VerificationSettingsPatch,
} from '../../lib/VerificationUtil.js';

const MODULE_HINT =
	'The **Member Verification** module is off, so the Verify button will not work. Turn it on with `/module enable`.';
const GLOBAL_OFF_HINT =
	'Member Verification is disabled globally by the bot owner, so it will not run until it is re-enabled.';

function describeRoles(settings: VerificationSettings): string {
	return fields([
		['Verified role', settings.roleId ? `<@&${settings.roleId}>` : '*(not set)*'],
		['Unverified role', settings.unverifiedRoleId ? `<@&${settings.unverifiedRoleId}>` : '*(none)*'],
	]);
}

function describeChecks(settings: VerificationSettings): string {
	return fields([
		['Captcha', settings.captchaEnabled ? 'On' : 'Off'],
		[
			'Minimum account age',
			settings.minAccountAgeDays > 0
				? `${settings.minAccountAgeDays} day${settings.minAccountAgeDays === 1 ? '' : 's'}`
				: 'None',
		],
	]);
}

function describeSettings(settings: VerificationSettings): string {
	return `${describeRoles(settings)}\n${describeChecks(settings)}`;
}

@ApplyOptions<Subcommand.Options>({
	name: 'verification',
	description: 'Set up the member verification gate for this server.',
	requiredUserPermissions: [PermissionFlagsBits.ManageGuild],
	preconditions: ['Moderation'],
	subcommands: [
		{ name: 'setup', chatInputRun: 'chatInputSetup' },
		{ name: 'panel', chatInputRun: 'chatInputPanel' },
		{ name: 'view', chatInputRun: 'chatInputView' },
	],
})
export class VerificationCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('verification')
				.setDescription('Set up the member verification gate for this server.')
				.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
				.addSubcommand((sub) =>
					sub
						.setName('setup')
						.setDescription('Configure verification and turn the module on. Omitted options keep their current value.')
						.addRoleOption((o) =>
							o.setName('role').setDescription('Role members receive once verified.').setRequired(true),
						)
						.addRoleOption((o) =>
							o
								.setName('unverified-role')
								.setDescription('Role given on join and removed on verification.')
								.setRequired(false),
						)
						.addBooleanOption((o) =>
							o.setName('captcha').setDescription('Require solving an image captcha.').setRequired(false),
						)
						.addIntegerOption((o) =>
							o
								.setName('min-account-age')
								.setDescription('Minimum Discord account age in days (0 = no minimum).')
								.setMinValue(0)
								.setMaxValue(365)
								.setRequired(false),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('panel')
						.setDescription('Post the verification panel with its Verify button.')
						.addChannelOption((o) =>
							o
								.setName('channel')
								.setDescription('Channel to post in (defaults to the current one).')
								.addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
								.setRequired(false),
						),
				)
				.addSubcommand((sub) => sub.setName('view').setDescription('Show the current verification settings.')),
		);
	}

	public async chatInputSetup(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const role = interaction.options.getRole('role', true);
		const unverifiedRole = interaction.options.getRole('unverified-role');
		const captcha = interaction.options.getBoolean('captcha');
		const minAge = interaction.options.getInteger('min-account-age');

		// The bot hands these roles to anyone who joins or verifies, so the invoker must be able to manage
		// them and they must carry no staff permissions (RoleSafety).
		const me = await fetchBotMember(interaction.guild);
		const roleProblem = configurableRoleError(role, interaction.member, me);
		if (roleProblem) return interaction.editReply(errorReply(`Verified role: ${roleProblem}`));
		if (unverifiedRole) {
			const unverifiedProblem = configurableRoleError(unverifiedRole, interaction.member, me);
			if (unverifiedProblem) return interaction.editReply(errorReply(`Unverified role: ${unverifiedProblem}`));
		}

		const existing = await getVerificationSettings(interaction.guildId);
		if ((unverifiedRole?.id ?? existing?.unverifiedRoleId) === role.id) {
			return interaction.editReply(errorReply('The verified role and the unverified role must be different roles.'));
		}

		const patch: VerificationSettingsPatch = { roleId: role.id };
		if (unverifiedRole) patch.unverifiedRoleId = unverifiedRole.id;
		if (captcha !== null) patch.captchaEnabled = captcha;
		if (minAge !== null) patch.minAccountAgeDays = minAge;
		const settings = await upsertVerificationSettings(interaction.guildId, patch);

		// The module defaults to off — setting up verification turns it on, also while it is globally
		// disabled so it runs as soon as the bot owner re-enables it.
		let note = '';
		const moduleState = await getVerificationModuleState(interaction.guildId);
		if (moduleState !== 'on') {
			await setModule(interaction.guildId, 'verification', true);
			note =
				moduleState === 'global-off'
					? `\n-# ${GLOBAL_OFF_HINT}`
					: '\n-# The **Member Verification** module was off for this server, so I turned it on.';
		}

		return interaction.editReply(
			successReply(
				`Verification is set up\n${describeSettings(settings)}\n-# Post the Verify button with \`/verification panel\`.${note}`,
			),
		);
	}

	public async chatInputPanel(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const settings = await getVerificationSettings(interaction.guildId);
		if (!settings?.roleId) {
			return interaction.editReply(errorReply('Set up verification first with `/verification setup`.'));
		}

		const channel = interaction.options.getChannel('channel') ?? interaction.channel;
		if (!channel?.isSendable()) return interaction.editReply(errorReply('I cannot post in that channel.'));

		const message = await channel.send({ components: [buildVerificationPanel()], flags: CV2_FLAG }).catch(() => null);
		if (!message) {
			return interaction.editReply(
				errorReply(`I couldn't post in <#${channel.id}>. Check that I can view it and send messages there.`),
			);
		}

		await upsertVerificationSettings(interaction.guildId, {
			panelChannelId: channel.id,
			panelMessageId: message.id,
		});

		let note = '';
		const moduleState = await getVerificationModuleState(interaction.guildId);
		if (moduleState === 'guild-off') note = `\n-# ${MODULE_HINT}`;
		else if (moduleState === 'global-off') note = `\n-# ${GLOBAL_OFF_HINT}`;

		return interaction.editReply(
			successReply(`Verification panel posted in <#${channel.id}>. [Jump to panel](${message.url})${note}`),
		);
	}

	public async chatInputView(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const settings = await getVerificationSettings(interaction.guildId);
		if (!settings) {
			return interaction.editReply(
				warningReply('Verification is not configured yet. Run `/verification setup` to get started.'),
			);
		}

		const moduleState = await getVerificationModuleState(interaction.guildId);
		const moduleText =
			moduleState === 'on' ? 'On' : moduleState === 'global-off' ? 'Off (disabled globally by the bot owner)' : 'Off';
		const panelText =
			settings.panelChannelId && settings.panelMessageId
				? `[Jump to panel](https://discord.com/channels/${interaction.guildId}/${settings.panelChannelId}/${settings.panelMessageId}) in <#${settings.panelChannelId}>`
				: '*(not posted yet)*';

		const container = makeContainer({ color: Colors.Info, header: 'Verification' });
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				fields([
					['Module', moduleText],
					['Panel', panelText],
				]),
			),
		);
		container.addSeparatorComponents(spacer());
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(describeRoles(settings)));
		container.addSeparatorComponents(spacer());
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(describeChecks(settings)));
		if (moduleState === 'guild-off') {
			container.addTextDisplayComponents(hint(MODULE_HINT));
		}

		return interaction.editReply({ components: [container], flags: CV2_FLAG });
	}
}
