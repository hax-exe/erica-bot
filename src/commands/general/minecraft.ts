import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChannelType,
	MessageFlags,
	PermissionFlagsBits,
	SectionBuilder,
	TextDisplayBuilder,
	ThumbnailBuilder,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { minecraftLinks } from '../../db/schema.js';
import { resolveRank, syncPortalProfile } from '../../lib/ApiServer.js';
import { Colors, cv2Reply, errorReply, makeContainer, successReply } from '../../lib/components.js';
import { db } from '../../lib/database.js';

// Minecraft Java Edition usernames: 3–16 chars, alphanumeric + underscores
const MC_USERNAME_REGEX = /^[a-zA-Z0-9_]{3,16}$/;

@ApplyOptions<Subcommand.Options>({
	name: 'minecraft',
	description: 'Link your Minecraft username to your Discord account.',
	subcommands: [
		{ name: 'link', chatInputRun: 'chatInputLink' },
		{ name: 'unlink', chatInputRun: 'chatInputUnlink' },
		{ name: 'whois', chatInputRun: 'chatInputWhois' },
		{ name: 'skin', chatInputRun: 'chatInputSkin' },
		{ name: 'status', chatInputRun: 'chatInputStatus' },
		{ name: 'forceverify', chatInputRun: 'chatInputForceVerify' },
		{ name: 'verify-panel', chatInputRun: 'chatInputVerifyPanel' },
	],
})
export class MinecraftCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('minecraft')
				.setDescription('Link your Minecraft username to your Discord account.')
				.addSubcommand((sub) =>
					sub
						.setName('link')
						.setDescription('Link your Minecraft username.')
						.addStringOption((o) =>
							o
								.setName('username')
								.setDescription('Your Minecraft Java Edition username.')
								.setRequired(true)
								.setMinLength(3)
								.setMaxLength(16),
						),
				)
				.addSubcommand((sub) => sub.setName('unlink').setDescription('Remove your linked Minecraft username.'))
				.addSubcommand((sub) =>
					sub
						.setName('whois')
						.setDescription("Look up a member's linked Minecraft username.")
						.addUserOption((o) => o.setName('user').setDescription('The user to look up.').setRequired(true)),
				)
				.addSubcommand((sub) =>
					sub
						.setName('skin')
						.setDescription('Show a 3D full-body skin render of a Minecraft player.')
						.addStringOption((o) =>
							o
								.setName('username')
								.setDescription('Minecraft username.')
								.setRequired(true)
								.setMinLength(3)
								.setMaxLength(16),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('status')
						.setDescription("Query a Minecraft server's status.")
						.addStringOption((o) =>
							o
								.setName('ip')
								.setDescription('Server IP (defaults to play.aloramc.com).')
								.setRequired(false)
								.setMaxLength(100),
						),
				)
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

	public async chatInputLink(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const username = interaction.options.getString('username', true).trim();
		if (!MC_USERNAME_REGEX.test(username)) {
			return interaction.editReply(
				errorReply('Invalid Minecraft username. Must be 3–16 characters (letters, numbers, underscores).'),
			);
		}

		await db
			.insert(minecraftLinks)
			.values({ userId: interaction.user.id, minecraftName: username })
			.onDuplicateKeyUpdate({ set: { minecraftName: username } });

		return interaction.editReply(successReply(`Linked your Minecraft username as **${username}**.`));
	}

	public async chatInputUnlink(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const [existing] = await db.select().from(minecraftLinks).where(eq(minecraftLinks.userId, interaction.user.id));

		if (!existing) {
			return interaction.editReply(errorReply("You don't have a Minecraft username linked."));
		}

		await db.delete(minecraftLinks).where(eq(minecraftLinks.userId, interaction.user.id));
		return interaction.editReply(successReply('Your Minecraft username has been unlinked.'));
	}

	public async chatInputWhois(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const target = interaction.options.getUser('user', true);
		const [link] = await db.select().from(minecraftLinks).where(eq(minecraftLinks.userId, target.id));

		if (!link) {
			return interaction.editReply(errorReply(`**${target.username}** hasn't linked a Minecraft username.`));
		}

		return interaction.editReply(successReply(`**${target.username}** → \`${link.minecraftName}\``));
	}

	public async chatInputSkin(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const username = interaction.options.getString('username', true).trim();
		if (!MC_USERNAME_REGEX.test(username)) {
			return interaction.editReply(
				errorReply('Invalid Minecraft username. Must be 3–16 characters (letters, numbers, underscores).'),
			);
		}

		const skinUrl = `https://mc-heads.net/body/${username}/left`;
		const downloadUrl = `https://mc-heads.net/download/${username}`;
		const avatarUrl = `https://mc-heads.net/avatar/${username}/256`;

		const c = makeContainer({ color: Colors.Info, header: `Minecraft Skin — ${username}` });
		const section = new SectionBuilder()
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`**Player:** \`${username}\`\n` +
						`**NameMC Profile:** [View Profile](https://namemc.com/profile/${username})`,
				),
			)
			.setThumbnailAccessory(new ThumbnailBuilder().setURL(skinUrl));

		c.addSectionComponents(section);

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Download Skin').setURL(downloadUrl),
			new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Avatar Render').setURL(avatarUrl),
			new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Full Render').setURL(skinUrl),
		);
		c.addActionRowComponents(row);

		return interaction.editReply(cv2Reply(c, true));
	}

	public async chatInputStatus(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const ip = interaction.options.getString('ip') ?? 'play.aloramc.com';

		let data: any;
		try {
			const res = await fetch(`https://api.mcsrvstat.us/2/${ip}`);
			if (!res.ok) throw new Error('API returned an error');
			data = await res.json();
		} catch (_err) {
			return interaction.editReply(errorReply('Failed to query the Minecraft server. Please try again later.'));
		}

		if (!data || data.online === false) {
			const c = makeContainer({ color: Colors.Error, header: 'Minecraft Server Status' });
			c.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(`**Server Address:** \`${ip}\`\n**Status:** 🔴 Offline / Unreachable`),
			);
			return interaction.editReply(cv2Reply(c, true));
		}

		const playersOnline = data.players?.online ?? 0;
		const playersMax = data.players?.max ?? 0;
		const version = data.version ?? 'Unknown';
		const cleanMotd = data.motd?.clean ? data.motd.clean.join('\n') : 'No MOTD';

		const c = makeContainer({ color: Colors.Success, header: 'Minecraft Server Status' });
		const iconUrl = `https://api.mcsrvstat.us/icon/${ip}`;

		const section = new SectionBuilder()
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`**Server Address:** \`${ip}\`\n` +
						`**Status:** 🟢 Online\n` +
						`**Players:** **${playersOnline.toLocaleString()}** / **${playersMax.toLocaleString()}**\n` +
						`**Version:** ${version}\n\n` +
						`**MOTD:**\n\`\`\`\n${cleanMotd}\n\`\`\``,
				),
			)
			.setThumbnailAccessory(new ThumbnailBuilder().setURL(iconUrl));

		c.addSectionComponents(section);
		return interaction.editReply(cv2Reply(c, true));
	}

	public async chatInputForceVerify(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		// Check permissions (Admins or Moderators only)
		const memberPermissions = interaction.memberPermissions;
		if (!interaction.inGuild() || !memberPermissions) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}
		const perms = BigInt(memberPermissions.bitfield);
		const isAdmin = (perms & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator;
		const modPerms =
			PermissionFlagsBits.ManageGuild |
			PermissionFlagsBits.KickMembers |
			PermissionFlagsBits.BanMembers |
			PermissionFlagsBits.ModerateMembers;
		const isMod = (perms & modPerms) !== 0n;
		if (!isAdmin && !isMod) {
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
			const res = await fetch(`https://api.mojang.com/users/profiles/minecraft/${username}`);
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
