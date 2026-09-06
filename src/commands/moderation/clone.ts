import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import {
	ChannelType,
	type GuildChannel,
	MessageFlags,
	type OverwriteResolvable,
	PermissionFlagsBits,
} from 'discord.js';
import { errorReply, successReply } from '../../lib/components.js';

@ApplyOptions<Command.Options>({
	name: 'clone',
	description: 'Clone a channel (keeps the original).',
	requiredUserPermissions: [PermissionFlagsBits.ManageChannels],
	requiredClientPermissions: [PermissionFlagsBits.ManageChannels],
	preconditions: ['Moderation'],
})
export class CloneCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('clone')
				.setDescription('Clone a channel (keeps the original).')
				.addChannelOption((o) =>
					o
						.setName('channel')
						.setDescription('Channel to clone (defaults to current).')
						.addChannelTypes(
							ChannelType.GuildText,
							ChannelType.GuildAnnouncement,
							ChannelType.GuildVoice,
							ChannelType.GuildStageVoice,
							ChannelType.GuildForum,
						)
						.setRequired(false),
				)
				.addStringOption((o) =>
					o.setName('name').setDescription('Name for the clone (defaults to name-copy).').setRequired(false),
				),
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const target =
			(interaction.options.getChannel('channel') as GuildChannel | null) ??
			(interaction.channel as GuildChannel | null);
		if (!target || !('permissionOverwrites' in target)) {
			return interaction.editReply(errorReply('Could not resolve that channel.'));
		}

		const name = interaction.options.getString('name')?.trim() || `${target.name}-copy`;
		const overwrites: OverwriteResolvable[] = target.permissionOverwrites.cache.map((ow) => ({
			id: ow.id,
			allow: ow.allow.bitfield,
			deny: ow.deny.bitfield,
			type: ow.type,
		}));

		const created = await interaction.guild.channels.create({
			name: name.slice(0, 100),
			type: target.type as any,
			topic: 'topic' in target ? ((target.topic as string | null) ?? undefined) : undefined,
			nsfw: 'nsfw' in target ? Boolean(target.nsfw) : undefined,
			rateLimitPerUser: 'rateLimitPerUser' in target ? Number(target.rateLimitPerUser) : undefined,
			bitrate: 'bitrate' in target ? Number(target.bitrate) : undefined,
			userLimit: 'userLimit' in target ? Number(target.userLimit) : undefined,
			parent: target.parentId ?? undefined,
			permissionOverwrites: overwrites,
			reason: `Cloned by ${interaction.user.tag}`,
		});

		return interaction.editReply(successReply(`Cloned <#${target.id}> → <#${created.id}>.`));
	}
}
