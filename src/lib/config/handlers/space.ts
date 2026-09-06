import type { Subcommand } from '@sapphire/plugin-subcommands';
import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { and, eq } from 'drizzle-orm';
import { errorReply, successReply, warningReply } from '../../../lib/components.js';
import { db, schema } from '../../../lib/database.js';

export class SpaceHandler {
	// ─── Helper ───────────────────────────────────────────────────────────────────

	private async getOwnedSpace(guildId: string, userId: string) {
		return db
			.select()
			.from(schema.activeSpaces)
			.where(and(eq(schema.activeSpaces.guildId, guildId), eq(schema.activeSpaces.ownerId, userId)))
			.limit(1)
			.then((r) => r[0] ?? null);
	}

	// ─── User subcommands ─────────────────────────────────────────────────────────

	public async chatInputRename(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const name = interaction.options.getString('name', true);
		const space = await this.getOwnedSpace(interaction.guildId, interaction.user.id);
		if (!space) return interaction.editReply(warningReply("You don't have an active space."));

		const channel = interaction.guild.channels.cache.get(space.channelId);
		if (!channel?.isVoiceBased()) {
			await db.delete(schema.activeSpaces).where(eq(schema.activeSpaces.channelId, space.channelId));
			return interaction.editReply(errorReply('Your space no longer exists.'));
		}

		await channel.setName(name);
		return interaction.editReply(successReply(`Space renamed to **${name}**.`));
	}

	public async chatInputLimit(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const number = interaction.options.getInteger('number', true);
		const space = await this.getOwnedSpace(interaction.guildId, interaction.user.id);
		if (!space) return interaction.editReply(warningReply("You don't have an active space."));

		const channel = interaction.guild.channels.cache.get(space.channelId);
		if (!channel?.isVoiceBased()) {
			await db.delete(schema.activeSpaces).where(eq(schema.activeSpaces.channelId, space.channelId));
			return interaction.editReply(errorReply('Your space no longer exists.'));
		}

		await channel.setUserLimit(number);
		return interaction.editReply(
			successReply(number === 0 ? 'User limit removed (unlimited).' : `User limit set to **${number}**.`),
		);
	}

	public async chatInputLock(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const space = await this.getOwnedSpace(interaction.guildId, interaction.user.id);
		if (!space) return interaction.editReply(warningReply("You don't have an active space."));

		const channel = interaction.guild.channels.cache.get(space.channelId);
		if (!channel?.isVoiceBased()) {
			await db.delete(schema.activeSpaces).where(eq(schema.activeSpaces.channelId, space.channelId));
			return interaction.editReply(errorReply('Your space no longer exists.'));
		}

		await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
			Connect: false,
		});
		return interaction.editReply(successReply('Space locked. No new users can join.'));
	}

	public async chatInputUnlock(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const space = await this.getOwnedSpace(interaction.guildId, interaction.user.id);
		if (!space) return interaction.editReply(warningReply("You don't have an active space."));

		const channel = interaction.guild.channels.cache.get(space.channelId);
		if (!channel?.isVoiceBased()) {
			await db.delete(schema.activeSpaces).where(eq(schema.activeSpaces.channelId, space.channelId));
			return interaction.editReply(errorReply('Your space no longer exists.'));
		}

		await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
			Connect: null,
		});
		return interaction.editReply(successReply('Space unlocked. Users can join again.'));
	}

	public async chatInputKick(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const target = interaction.options.getMember('user');
		if (!target) return interaction.editReply(errorReply('User not found in this server.'));
		if (target.id === interaction.user.id) return interaction.editReply(errorReply("You can't kick yourself."));

		const space = await this.getOwnedSpace(interaction.guildId, interaction.user.id);
		if (!space) return interaction.editReply(warningReply("You don't have an active space."));

		if (target.voice.channelId !== space.channelId) {
			return interaction.editReply(warningReply('That user is not in your space.'));
		}

		await target.voice.disconnect().catch(() => null);
		return interaction.editReply(successReply(`**${target.displayName}** was disconnected from your space.`));
	}

	// ─── Config subcommands ───────────────────────────────────────────────────────

	public async chatInputConfigSetTrigger(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));
		if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
			return interaction.editReply(errorReply('You need Manage Server to do this.'));
		}

		const channel = interaction.options.getChannel('channel');
		await db
			.insert(schema.spaceSettings)
			.values({ guildId: interaction.guildId, triggerChannelId: channel?.id ?? null })
			.onDuplicateKeyUpdate({ set: { triggerChannelId: channel?.id ?? null } });

		return interaction.editReply(
			channel
				? successReply(`Trigger channel set to **${channel.name}**. Users who join it will get their own space.`)
				: successReply('Trigger channel cleared.'),
		);
	}

	public async chatInputConfigSetCategory(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));
		if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
			return interaction.editReply(errorReply('You need Manage Server to do this.'));
		}

		const category = interaction.options.getChannel('category');
		await db
			.insert(schema.spaceSettings)
			.values({ guildId: interaction.guildId, categoryId: category?.id ?? null })
			.onDuplicateKeyUpdate({ set: { categoryId: category?.id ?? null } });

		return interaction.editReply(
			category
				? successReply(`New spaces will be created under **${category.name}**.`)
				: successReply("Category cleared — new spaces will use the trigger channel's category."),
		);
	}

	public async chatInputConfigSetLimit(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));
		if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
			return interaction.editReply(errorReply('You need Manage Server to do this.'));
		}

		const limit = interaction.options.getInteger('limit') ?? 0;
		await db
			.insert(schema.spaceSettings)
			.values({ guildId: interaction.guildId, userLimit: limit })
			.onDuplicateKeyUpdate({ set: { userLimit: limit } });

		return interaction.editReply(
			successReply(limit === 0 ? 'Default user limit set to unlimited.' : `Default user limit set to **${limit}**.`),
		);
	}

	public async chatInputConfigSetName(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));
		if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
			return interaction.editReply(errorReply('You need Manage Server to do this.'));
		}

		const template = interaction.options.getString('template');
		await db
			.insert(schema.spaceSettings)
			.values({ guildId: interaction.guildId, nameTemplate: template ?? null })
			.onDuplicateKeyUpdate({ set: { nameTemplate: template ?? null } });

		return interaction.editReply(
			template
				? successReply(`Name template set to \`${template}\`.`)
				: successReply("Name template reset to default (`{displayname}'s Space`)."),
		);
	}

	public async chatInputConfigToggle(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));
		if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
			return interaction.editReply(errorReply('You need Manage Server to do this.'));
		}

		const settings = await db
			.select()
			.from(schema.spaceSettings)
			.where(eq(schema.spaceSettings.guildId, interaction.guildId))
			.limit(1)
			.then((r) => r[0] ?? null);

		if (!settings?.triggerChannelId) {
			return interaction.editReply(warningReply('Set a trigger channel first with `/space config settrigger`.'));
		}

		const newEnabled = !settings.enabled;
		await db
			.insert(schema.spaceSettings)
			.values({ guildId: interaction.guildId, enabled: newEnabled })
			.onDuplicateKeyUpdate({ set: { enabled: newEnabled } });

		return interaction.editReply(successReply(`Space system ${newEnabled ? 'enabled ✅' : 'disabled ❌'}.`));
	}
}
