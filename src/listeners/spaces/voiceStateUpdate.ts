import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { ChannelType, Events, PermissionFlagsBits, type VoiceState } from 'discord.js';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../../lib/database.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';

const DEFAULT_TEMPLATE = "{displayname}'s Space";

function resolveChannelName(
	template: string | null | undefined,
	displayName: string,
	username: string,
	serverName: string,
): string {
	return (template ?? DEFAULT_TEMPLATE)
		.replace(/{displayname}/g, displayName)
		.replace(/{username}/g, username)
		.replace(/{server}/g, serverName)
		.slice(0, 100);
}

@ApplyOptions<Listener.Options>({
	name: 'spacesVoiceStateUpdate',
	event: Events.VoiceStateUpdate,
})
export class SpacesVoiceStateUpdateListener extends Listener<typeof Events.VoiceStateUpdate> {
	public override async run(oldState: VoiceState, newState: VoiceState) {
		const guildId = newState.guild.id;
		if (!(await isModuleEnabled(guildId, 'spaces'))) return;

		// User joined a channel (or switched to a new one)
		if (newState.channelId && newState.channelId !== oldState.channelId) {
			await this.handleJoin(newState, guildId).catch((err) =>
				this.container.logger.error('[spaces] handleJoin error:', err),
			);
		}

		// User left a channel (or switched away from one)
		if (oldState.channelId && oldState.channelId !== newState.channelId) {
			await this.handleLeave(oldState, guildId).catch((err) =>
				this.container.logger.error('[spaces] handleLeave error:', err),
			);
		}
	}

	private async handleJoin(state: VoiceState, guildId: string) {
		const settings = await db
			.select()
			.from(schema.spaceSettings)
			.where(eq(schema.spaceSettings.guildId, guildId))
			.limit(1)
			.then((r) => r[0] ?? null);

		if (!settings?.enabled || !settings.triggerChannelId) return;
		if (state.channelId !== settings.triggerChannelId) return;
		if (!state.member) return;

		const member = state.member;
		const guild = state.guild;

		// If the member already owns a space, send them there instead of creating a new one
		const existingSpace = await db
			.select()
			.from(schema.activeSpaces)
			.where(and(eq(schema.activeSpaces.guildId, guildId), eq(schema.activeSpaces.ownerId, member.id)))
			.limit(1)
			.then((r) => r[0] ?? null);

		if (existingSpace) {
			const existingChannel = guild.channels.cache.get(existingSpace.channelId);
			if (existingChannel?.isVoiceBased()) {
				await state.setChannel(existingChannel).catch(() => null);
				return;
			}
			// Stale record — channel was deleted externally; clean up and create a fresh one
			await db.delete(schema.activeSpaces).where(eq(schema.activeSpaces.channelId, existingSpace.channelId));
		}

		// Resolve parent category — prefer configured, then fall back to trigger channel's category
		const triggerChannel = guild.channels.cache.get(settings.triggerChannelId);
		const parentId = settings.categoryId ?? triggerChannel?.parentId ?? undefined;

		const name = resolveChannelName(settings.nameTemplate, member.displayName, member.user.username, guild.name);

		const newChannel = await guild.channels.create({
			name,
			type: ChannelType.GuildVoice,
			parent: parentId,
			userLimit: settings.userLimit,
			permissionOverwrites: [
				// Give the owner full control over their space
				{
					id: member.id,
					allow: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers, PermissionFlagsBits.Connect],
				},
			],
		});

		// Move member into their new space
		await state.setChannel(newChannel).catch(() => null);

		// Persist
		await db.insert(schema.activeSpaces).values({
			channelId: newChannel.id,
			guildId,
			ownerId: member.id,
		});
	}

	private async handleLeave(state: VoiceState, guildId: string) {
		if (!state.channelId) return;

		const space = await db
			.select()
			.from(schema.activeSpaces)
			.where(and(eq(schema.activeSpaces.channelId, state.channelId), eq(schema.activeSpaces.guildId, guildId)))
			.limit(1)
			.then((r) => r[0] ?? null);

		if (!space) return;

		const channel = state.guild.channels.cache.get(state.channelId);

		if (!channel?.isVoiceBased()) {
			// Channel was already deleted externally
			await db.delete(schema.activeSpaces).where(eq(schema.activeSpaces.channelId, state.channelId));
			return;
		}

		if (channel.members.size > 0) return; // Still occupied

		await channel.delete('Empty space channel.').catch(() => null);
		await db.delete(schema.activeSpaces).where(eq(schema.activeSpaces.channelId, state.channelId));
	}
}
