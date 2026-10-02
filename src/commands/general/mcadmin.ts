import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { ChannelType, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { minecraftLinks } from '../../db/schema.js';
import { resolveRank, syncPortalProfile } from '../../lib/ApiServer.js';
import { USER_AGENT } from '../../lib/brand.js';
import { errorReply, successReply } from '../../lib/components.js';
import { db } from '../../lib/database.js';
import { MC_USERNAME_REGEX } from '../../lib/VerificationUtil.js';

/**
 * Staff Minecraft tools. Split out of `/minecraft` so the whole command can carry a
 * ManageGuild default permission (Discord can't hide individual subcommands). The
 * runtime permission checks stay as defence in depth — server admins can override
 * command visibility in Integrations settings.
 */
@ApplyOptions<Subcommand.Options>({
	name: 'mcadmin',
	description: 'Minecraft verification tools (Staff only).',
	subcommands: [
		{ name: 'forceverify', chatInputRun: 'chatInputForceVerify' },
		{ name: 'verify-panel', chatInputRun: 'chatInputVerifyPanel' },
	],
})
export class McAdminCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('mcadmin')
				.setDescription('Minecraft verification tools (Staff only).')
				.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
				.addSubcommand((sub) =>
					sub
						.setName('forceverify')
						.setDescription('Force verify a Discord user as a Minecraft player (Staff only).')
						.addUserOption((o) => o.setName('user').setDescription('The Discord user to verify.').setRequired(true))
						.addStringOption((o) =>
							o
								.setName('username')
								.setDescription('Their Minecraft Java Edition username.')
								.setRequired(true)
								.setMinLength(3)
								.setMaxLength(16),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('verify-panel')
						.setDescription('Post the Minecraft verification panel.')
						.addChannelOption((o) =>
							o
								.setName('channel')
								.setDescription('Channel to post the panel in (defaults to current).')
								.addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
								.setRequired(false),
						),
				),
		);
	}

	public async chatInputForceVerify(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		// Check permissions (Administrator or Manage Server only)
		const memberPermissions = interaction.memberPermissions;
		if (!interaction.inGuild() || !memberPermissions) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}
		const perms = BigInt(memberPermissions.bitfield);
		const isAdmin = (perms & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator;
		const isManager = (perms & PermissionFlagsBits.ManageGuild) !== 0n;
		if (!isAdmin && !isManager) {
			return interaction.editReply(errorReply('You do not have permission to use this command.'));
		}

		const target = interaction.options.getUser('user', true);
		const username = interaction.options.getString('username', true).trim();

		if (!MC_USERNAME_REGEX.test(username)) {
			return interaction.editReply(
				errorReply('Invalid Minecraft username. Must be 3–16 characters (letters, numbers, underscores).'),
			);
		}

		let resolvedName = username;
		let resolvedUuid: string | null = null;

		try {
			const res = await fetch(`https://api.mojang.com/users/profiles/minecraft/${username}`, {
				headers: { 'User-Agent': USER_AGENT },
				signal: AbortSignal.timeout(10_000),
			});
			if (res.status === 200) {
				const data = (await res.json()) as { id: string; name: string };
				resolvedUuid = data.id;
				resolvedName = data.name;
			} else if (res.status === 204 || res.status === 404) {
				return interaction.editReply(errorReply(`Minecraft player **${username}** does not exist.`));
			} else {
				this.container.logger.warn(`Mojang API returned status ${res.status} for ${username}`);
			}
		} catch (err) {
			this.container.logger.error(`Failed to lookup Mojang profile for ${username}:`, err);
		}

		// Save link to DB
		await db
			.insert(minecraftLinks)
			.values({ userId: target.id, minecraftName: resolvedName, minecraftUuid: resolvedUuid })
			.onDuplicateKeyUpdate({
				set: { minecraftName: resolvedName, minecraftUuid: resolvedUuid, linkedAt: new Date() },
			});

		// Assign verified role
		const verifiedRoleId = process.env.VERIFIED_ROLE_ID;
		let memberRoleIds = new Set<string>();

		if (verifiedRoleId) {
			try {
				const member = await interaction.guild!.members.fetch(target.id);
				await member.roles.add(verifiedRoleId, `Minecraft force verification by ${interaction.user.username}`);
				memberRoleIds = new Set(member.roles.cache.keys());
			} catch (err) {
				this.container.logger.warn(`[ForceVerify] Could not assign verified role to ${target.id}:`, err);
			}
		} else {
			this.container.logger.warn('[ForceVerify] VERIFIED_ROLE_ID is not configured.');
		}

		// Sync portal profile
		const resolved = resolveRank(memberRoleIds);
		await syncPortalProfile(target.id, resolvedName, resolvedUuid, resolved.rank, resolved.roles);

		return interaction.editReply(
			successReply(`Manually verified **${target.username}** as Minecraft player **${resolvedName}**.`, true),
		);
	}

	public async chatInputVerifyPanel(interaction: Subcommand.ChatInputCommandInteraction) {
		const { VerificationHandler } = await import('../../lib/config/handlers/verification.js');
		return new VerificationHandler().chatInputRun(interaction);
	}
}
