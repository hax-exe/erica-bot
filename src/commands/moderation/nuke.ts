import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import {
	ChannelType,
	type GuildTextBasedChannel,
	MessageFlags,
	type OverwriteResolvable,
	PermissionFlagsBits,
	type TextChannel,
} from 'discord.js';
import { errorReply, successReply, warningReply } from '../../lib/components.js';

@ApplyOptions<Command.Options>({
	name: 'nuke',
	description: 'Clone this channel and delete the original (clears messages).',
	requiredUserPermissions: [PermissionFlagsBits.ManageChannels],
	requiredClientPermissions: [PermissionFlagsBits.ManageChannels],
	preconditions: ['Moderation'],
})
export class NukeCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('nuke')
				.setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
				.setDescription('Clone this channel and delete the original (clears all messages).')
				.addBooleanOption((o) => o.setName('confirm').setDescription('Must be true to nuke.').setRequired(true))
				.addChannelOption((o) =>
					o
						.setName('channel')
						.setDescription('Channel to nuke (defaults to current).')
						.addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
						.setRequired(false),
				),
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		if (!interaction.options.getBoolean('confirm', true)) {
			return interaction.editReply(warningReply('Set `confirm` to true to nuke the channel.'));
		}

		const picked = interaction.options.getChannel('channel');
		const target = (picked ?? interaction.channel) as TextChannel | null;
		if (!target || (target.type !== ChannelType.GuildText && target.type !== ChannelType.GuildAnnouncement)) {
			return interaction.editReply(errorReply('Pick a text or announcement channel.'));
		}

		const overwrites: OverwriteResolvable[] = target.permissionOverwrites.cache.map((ow) => ({
			id: ow.id,
			allow: ow.allow.bitfield,
			deny: ow.deny.bitfield,
			type: ow.type,
		}));

		const created = await interaction.guild.channels
			.create({
				name: target.name,
				type: target.type,
				topic: target.topic ?? undefined,
				nsfw: target.nsfw,
				rateLimitPerUser: target.rateLimitPerUser,
				parent: target.parentId ?? undefined,
				permissionOverwrites: overwrites,
				reason: `Nuked by ${interaction.user.tag}`,
			})
			.catch((err) => {
				this.container.logger.error(err);
				return null;
			});
		if (!created) {
			return interaction.editReply(errorReply('Failed to clone the channel. Do I have **Manage Channels**?'));
		}

		await created.setPosition(target.position).catch(() => null);

		// The ephemeral reply lives in the channel being nuked, so when that is the current channel
		// answer before deleting it — an edit afterwards would fail with the channel gone.
		const nukingCurrent = interaction.channelId === target.id;
		if (nukingCurrent) {
			await interaction.editReply(successReply(`Nuked — new channel: <#${created.id}>.`)).catch(() => null);
		}

		const deleted = await target
			.delete(`Nuked by ${interaction.user.tag}`)
			.then(() => true)
			.catch(() => false);
		if (!deleted) {
			return interaction.editReply(
				warningReply(`Created <#${created.id}>, but I could not delete the original channel <#${target.id}>.`),
			);
		}

		await (created as GuildTextBasedChannel)
			.send({ content: `Channel nuked by ${interaction.user}.` })
			.catch(() => null);

		if (nukingCurrent) return;
		return interaction.editReply(successReply(`Nuked — new channel: <#${created.id}>.`));
	}
}
