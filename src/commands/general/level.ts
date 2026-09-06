import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { AttachmentBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { and, eq } from 'drizzle-orm';
import { errorReply, successReply, warningReply } from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';
import { buildLeaderboardPage } from '../../lib/LeaderboardUtil.js';
import {
	addXpAdmin,
	getOrCreateLevelSettings,
	getRank,
	getXpRow,
	levelFromTotalXp,
	resetXp,
	setXp,
} from '../../lib/LevelingUtil.js';
import { renderRankCard } from '../../lib/RankCardUtil.js';

function hasModPerms(perms: Readonly<import('discord.js').PermissionsBitField> | null): boolean {
	if (!perms) return false;
	if (perms.has(PermissionFlagsBits.Administrator)) return true;
	const modPerms =
		PermissionFlagsBits.ManageGuild |
		PermissionFlagsBits.KickMembers |
		PermissionFlagsBits.BanMembers |
		PermissionFlagsBits.ModerateMembers;
	return perms.has(modPerms);
}

@ApplyOptions<Subcommand.Options>({
	name: 'level',
	description: 'View, customize, or manage leveling and XP.',
	subcommands: [
		{ name: 'rank', chatInputRun: 'chatInputRank', default: true },
		{ name: 'customize', chatInputRun: 'chatInputCustomize' },
		{ name: 'leaderboard', chatInputRun: 'chatInputLeaderboard' },
		{ name: 'set', chatInputRun: 'chatInputSet' },
		{ name: 'add', chatInputRun: 'chatInputAdd' },
		{ name: 'remove', chatInputRun: 'chatInputRemove' },
		{ name: 'reset', chatInputRun: 'chatInputReset' },
	],
})
export class LevelCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('level')
				.setDescription('View, customize, or manage leveling and XP.')
				.addSubcommand((sub) =>
					sub
						.setName('rank')
						.setDescription("View a member's level and rank card.")
						.addUserOption((o) => o.setName('user').setDescription('The user to view.').setRequired(false)),
				)
				.addSubcommand((sub) =>
					sub
						.setName('customize')
						.setDescription('Customize your rank card background and accent color.')
						.addStringOption((o) =>
							o
								.setName('accent_color')
								.setDescription('Custom accent color hex code (e.g. #FF5733).')
								.setRequired(false),
						)
						.addStringOption((o) =>
							o
								.setName('background_type')
								.setDescription('Type of background to apply.')
								.setRequired(false)
								.addChoices(
									{ name: 'Default (Slate Grey)', value: 'default' },
									{ name: 'Custom Solid Color', value: 'color' },
									{ name: 'Preset Background Image', value: 'preset' },
									{ name: 'Custom Image URL', value: 'image' },
								),
						)
						.addStringOption((o) =>
							o
								.setName('background_value')
								.setDescription('The hex color, preset name (cyberpunk, galaxy, minecraft, sunset), or image URL.')
								.setRequired(false),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('leaderboard')
						.setDescription('View the server XP leaderboard.')
						.addIntegerOption((o) =>
							o
								.setName('entries')
								.setDescription('Number of entries to show per page (default 10, max 20).')
								.setMinValue(3)
								.setMaxValue(20)
								.setRequired(false),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('set')
						.setDescription("Set a member's total XP (Moderator only).")
						.addUserOption((o) => o.setName('user').setDescription('Target member').setRequired(true))
						.addIntegerOption((o) =>
							o.setName('amount').setDescription('Total XP to set').setMinValue(0).setRequired(true),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('add')
						.setDescription('Add XP to a member (Moderator only).')
						.addUserOption((o) => o.setName('user').setDescription('Target member').setRequired(true))
						.addIntegerOption((o) => o.setName('amount').setDescription('XP to add').setMinValue(1).setRequired(true)),
				)
				.addSubcommand((sub) =>
					sub
						.setName('remove')
						.setDescription('Remove XP from a member (Moderator only).')
						.addUserOption((o) => o.setName('user').setDescription('Target member').setRequired(true))
						.addIntegerOption((o) =>
							o.setName('amount').setDescription('XP to remove').setMinValue(1).setRequired(true),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('reset')
						.setDescription("Reset a member's XP to 0 (Moderator only).")
						.addUserOption((o) => o.setName('user').setDescription('Target member').setRequired(true)),
				),
		);
	}

	public async chatInputRank(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();

		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}

		const settings = await getOrCreateLevelSettings(interaction.guildId);
		if (!settings.enabled) {
			return interaction.editReply(errorReply('Leveling is not enabled in this server.'));
		}

		const targetUser = interaction.options.getUser('user') ?? interaction.user;
		const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

		const row = await getXpRow(interaction.guildId, targetUser.id);
		const totalXp = row?.totalXp ?? 0;
		const { level, currentXp, xpNeeded } = levelFromTotalXp(totalXp);
		const rank = row ? await getRank(interaction.guildId, targetUser.id) : -1;

		const buffer = await renderRankCard({
			displayName: member?.displayName ?? targetUser.username,
			username: targetUser.username,
			avatarURL: targetUser.displayAvatarURL({ size: 256, extension: 'png' }),
			rank: rank < 1 ? 999 : rank,
			level,
			currentXp,
			xpNeeded,
			accentColor: row?.accentColor,
			backgroundType: row?.backgroundType,
			backgroundValue: row?.backgroundValue,
		});

		const attachment = new AttachmentBuilder(buffer, { name: 'rank.png' });
		return interaction.editReply({ files: [attachment] });
	}

	public async chatInputCustomize(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}

		const accentColor = interaction.options.getString('accent_color');
		const bgTypeInput = interaction.options.getString('background_type');
		const bgValue = interaction.options.getString('background_value');

		const updates: Record<string, any> = {};

		// Validate accent color if provided
		if (accentColor !== null) {
			const cleanHex = accentColor.trim().startsWith('#') ? accentColor.trim() : `#${accentColor.trim()}`;
			if (!/^#[0-9A-Fa-f]{6}$/.test(cleanHex)) {
				return interaction.editReply(
					errorReply('Invalid hex color format for accent color. Example: `#FF5733` or `FF5733`.'),
				);
			}
			updates.accentColor = cleanHex;
		}

		// Validate background settings
		if (bgTypeInput !== null) {
			if (bgTypeInput === 'default') {
				updates.backgroundType = 'color';
				updates.backgroundValue = null;
			} else {
				if (!bgValue) {
					return interaction.editReply(
						errorReply('You must provide a background value when setting a color, preset, or image.'),
					);
				}

				if (bgTypeInput === 'color') {
					const cleanHex = bgValue.trim().startsWith('#') ? bgValue.trim() : `#${bgValue.trim()}`;
					if (!/^#[0-9A-Fa-f]{6}$/.test(cleanHex)) {
						return interaction.editReply(
							errorReply('Invalid hex color format for background color. Example: `#1e1e2e` or `1e1e2e`.'),
						);
					}
					updates.backgroundType = 'color';
					updates.backgroundValue = cleanHex;
				} else if (bgTypeInput === 'preset') {
					const presetKey = bgValue.trim().toLowerCase();
					const validPresets = ['cyberpunk', 'galaxy', 'minecraft', 'sunset'];
					if (!validPresets.includes(presetKey)) {
						return interaction.editReply(errorReply(`Invalid preset name. Choose from: ${validPresets.join(', ')}`));
					}

					// Verify ownership in shop items / inventory
					const itemKey = `bg_${presetKey}`;
					const shopItem = await db.query.shopItems.findFirst({
						where: and(eq(schema.shopItems.guildId, interaction.guildId), eq(schema.shopItems.itemKey, itemKey)),
					});

					if (!shopItem) {
						return interaction.editReply(
							errorReply(`The shop item for preset background **${presetKey}** is not registered.`),
						);
					}

					const inventoryEntry = await db.query.userInventory.findFirst({
						where: and(
							eq(schema.userInventory.guildId, interaction.guildId),
							eq(schema.userInventory.userId, interaction.user.id),
							eq(schema.userInventory.itemId, shopItem.id),
						),
					});

					if (!inventoryEntry || inventoryEntry.quantity < 1) {
						return interaction.editReply(
							errorReply(`You do not own the **${shopItem.name}**! Buy it in the shop using \`/economy shop buy\`.`),
						);
					}

					updates.backgroundType = 'preset';
					updates.backgroundValue = presetKey;
				} else if (bgTypeInput === 'image') {
					// Verify ownership of the Custom BG URL Card
					const shopItem = await db.query.shopItems.findFirst({
						where: and(
							eq(schema.shopItems.guildId, interaction.guildId),
							eq(schema.shopItems.itemKey, 'bg_custom_url'),
						),
					});

					if (!shopItem) {
						return interaction.editReply(
							errorReply('The shop item for Custom Image URL backgrounds is not registered.'),
						);
					}

					const inventoryEntry = await db.query.userInventory.findFirst({
						where: and(
							eq(schema.userInventory.guildId, interaction.guildId),
							eq(schema.userInventory.userId, interaction.user.id),
							eq(schema.userInventory.itemId, shopItem.id),
						),
					});

					if (!inventoryEntry || inventoryEntry.quantity < 1) {
						return interaction.editReply(
							errorReply(`You do not own the **${shopItem.name}**! Buy it in the shop using \`/economy shop buy\`.`),
						);
					}

					// Validate URL format
					const urlPattern = /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([/\w .-]*)*\/?$/i;
					if (!urlPattern.test(bgValue.trim())) {
						return interaction.editReply(errorReply('Invalid image URL format.'));
					}

					updates.backgroundType = 'image';
					updates.backgroundValue = bgValue.trim();
				}
			}
		}

		if (Object.keys(updates).length === 0) {
			return interaction.editReply(warningReply('No customization options were specified.'));
		}

		// Update or create the XP row
		const existing = await getXpRow(interaction.guildId, interaction.user.id);
		if (existing) {
			await db
				.update(schema.xp)
				.set(updates)
				.where(and(eq(schema.xp.guildId, interaction.guildId), eq(schema.xp.userId, interaction.user.id)));
		} else {
			await db.insert(schema.xp).values({
				guildId: interaction.guildId,
				userId: interaction.user.id,
				totalXp: 0,
				level: 0,
				...updates,
			});
		}

		return interaction.editReply(
			successReply('Your rank card customization has been saved! View it with `/level rank`.'),
		);
	}

	public async chatInputLeaderboard(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();

		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}

		const settings = await getOrCreateLevelSettings(interaction.guildId);
		if (!settings.enabled) {
			return interaction.editReply(errorReply('Leveling is not enabled in this server.'));
		}

		const limit = interaction.options.getInteger('entries') ?? 10;
		const payload = await buildLeaderboardPage(
			interaction.guildId,
			interaction.guild.name,
			limit,
			0,
			interaction.client,
		);

		if (payload.content && !payload.files?.length) {
			return interaction.editReply(errorReply(payload.content));
		}

		return interaction.editReply(payload);
	}

	// ── admin / moderator handlers ──

	public async chatInputSet(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return;

		if (!hasModPerms(interaction.memberPermissions)) {
			return interaction.editReply(errorReply('You do not have permission to manage member XP.'));
		}

		const user = interaction.options.getUser('user', true);
		const amount = interaction.options.getInteger('amount', true);
		await setXp(interaction.guildId, user.id, amount);
		const { level } = levelFromTotalXp(amount);
		return interaction.editReply(
			successReply(`Set **${user.tag}**'s XP to **${amount.toLocaleString()}** (Level ${level}).`),
		);
	}

	public async chatInputAdd(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return;

		if (!hasModPerms(interaction.memberPermissions)) {
			return interaction.editReply(errorReply('You do not have permission to manage member XP.'));
		}

		const user = interaction.options.getUser('user', true);
		const amount = interaction.options.getInteger('amount', true);
		const result = await addXpAdmin(interaction.guildId, user.id, amount);
		return interaction.editReply(
			successReply(
				`Added **${amount.toLocaleString()} XP** to **${user.tag}** → ${result.totalXp.toLocaleString()} XP (Level ${result.level}).`,
			),
		);
	}

	public async chatInputRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return;

		if (!hasModPerms(interaction.memberPermissions)) {
			return interaction.editReply(errorReply('You do not have permission to manage member XP.'));
		}

		const user = interaction.options.getUser('user', true);
		const amount = interaction.options.getInteger('amount', true);
		const result = await addXpAdmin(interaction.guildId, user.id, -amount);
		return interaction.editReply(
			successReply(
				`Removed **${amount.toLocaleString()} XP** from **${user.tag}** → ${result.totalXp.toLocaleString()} XP (Level ${result.level}).`,
			),
		);
	}

	public async chatInputReset(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return;

		if (!hasModPerms(interaction.memberPermissions)) {
			return interaction.editReply(errorReply('You do not have permission to manage member XP.'));
		}

		const user = interaction.options.getUser('user', true);
		await resetXp(interaction.guildId, user.id);
		return interaction.editReply(successReply(`Reset **${user.tag}**'s XP.`));
	}
}
