import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import {
	ChannelType,
	type GuildMember,
	MessageFlags,
	PermissionFlagsBits,
	TextDisplayBuilder,
	userMention,
} from 'discord.js';
import { Colors, CV2_FLAG, errorReply, logContainer, makeContainer, successReply } from '../../lib/components.js';
import { sendModLog } from '../../lib/LoggingUtil.js';
import { checkHierarchy } from '../../lib/ModerationUtil.js';

@ApplyOptions<Subcommand.Options>({
	name: 'vc',
	description: 'Voice channel moderation utilities.',
	preconditions: ['Moderation'],
	subcommands: [
		{ name: 'deafen', chatInputRun: 'chatInputDeafen' },
		{ name: 'deafenall', chatInputRun: 'chatInputDeafenAll' },
		{ name: 'undeafenall', chatInputRun: 'chatInputUndeafenAll' },
		{ name: 'mute', chatInputRun: 'chatInputMute' },
		{ name: 'muteall', chatInputRun: 'chatInputMuteAll' },
		{ name: 'unmuteall', chatInputRun: 'chatInputUnmuteAll' },
		{ name: 'kick', chatInputRun: 'chatInputKick' },
		{ name: 'move', chatInputRun: 'chatInputMove' },
		{ name: 'moveall', chatInputRun: 'chatInputMoveAll' },
	],
})
export class VcCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('vc')
				.setDescription('Voice channel moderation utilities.')
				.setDefaultMemberPermissions(
					PermissionFlagsBits.MuteMembers | PermissionFlagsBits.DeafenMembers | PermissionFlagsBits.MoveMembers,
				)
				// deafen
				.addSubcommand((sub) =>
					sub
						.setName('deafen')
						.setDescription('Server-deafen a member in voice channels.')
						.addUserOption((o) => o.setName('user').setDescription('The member to server-deafen.').setRequired(true))
						.addStringOption((o) => o.setName('reason').setDescription('Reason for the deafen.').setRequired(false))
						.addBooleanOption((o) =>
							o.setName('undeafen').setDescription('Set to true to undeafen instead.').setRequired(false),
						),
				)
				// deafenall
				.addSubcommand((sub) =>
					sub
						.setName('deafenall')
						.setDescription('Deafen all members in a voice channel.')
						.addChannelOption((o) =>
							o
								.setName('channel')
								.setDescription('Voice channel to deafen everyone in.')
								.setRequired(true)
								.addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice),
						)
						.addStringOption((o) => o.setName('reason').setDescription('Reason for the deafen.').setRequired(false)),
				)
				// undeafenall
				.addSubcommand((sub) =>
					sub
						.setName('undeafenall')
						.setDescription('Undeafen all members in a voice channel.')
						.addChannelOption((o) =>
							o
								.setName('channel')
								.setDescription('Voice channel to undeafen everyone in.')
								.setRequired(true)
								.addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice),
						)
						.addStringOption((o) => o.setName('reason').setDescription('Reason for the undeafen.').setRequired(false)),
				)
				// mute
				.addSubcommand((sub) =>
					sub
						.setName('mute')
						.setDescription('Server-mute a member in voice channels.')
						.addUserOption((o) => o.setName('user').setDescription('The member to server-mute.').setRequired(true))
						.addStringOption((o) => o.setName('reason').setDescription('Reason for the mute.').setRequired(false))
						.addBooleanOption((o) =>
							o.setName('unmute').setDescription('Set to true to unmute instead.').setRequired(false),
						),
				)
				// muteall
				.addSubcommand((sub) =>
					sub
						.setName('muteall')
						.setDescription('Mute all members in a voice channel.')
						.addChannelOption((o) =>
							o
								.setName('channel')
								.setDescription('Voice channel to mute everyone in.')
								.setRequired(true)
								.addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice),
						)
						.addStringOption((o) => o.setName('reason').setDescription('Reason for the mute.').setRequired(false)),
				)
				// unmuteall
				.addSubcommand((sub) =>
					sub
						.setName('unmuteall')
						.setDescription('Unmute all members in a voice channel.')
						.addChannelOption((o) =>
							o
								.setName('channel')
								.setDescription('Voice channel to unmute everyone in.')
								.setRequired(true)
								.addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice),
						)
						.addStringOption((o) => o.setName('reason').setDescription('Reason for the unmute.').setRequired(false)),
				)
				// kick
				.addSubcommand((sub) =>
					sub
						.setName('kick')
						.setDescription('Disconnect a member from their current voice channel.')
						.addUserOption((o) => o.setName('user').setDescription('The member to disconnect.').setRequired(true))
						.addStringOption((o) =>
							o.setName('reason').setDescription('Reason for the disconnect.').setRequired(false),
						),
				)
				// move
				.addSubcommand((sub) =>
					sub
						.setName('move')
						.setDescription('Move a member to a different voice channel.')
						.addUserOption((o) => o.setName('user').setDescription('The member to move.').setRequired(true))
						.addChannelOption((o) =>
							o
								.setName('channel')
								.setDescription('The voice channel to move them to.')
								.setRequired(true)
								.addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice),
						)
						.addStringOption((o) => o.setName('reason').setDescription('Reason for the move.').setRequired(false)),
				)
				// moveall
				.addSubcommand((sub) =>
					sub
						.setName('moveall')
						.setDescription('Move all members from one voice channel to another.')
						.addChannelOption((o) =>
							o
								.setName('from_channel')
								.setDescription('Voice channel to move members from.')
								.setRequired(true)
								.addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice),
						)
						.addChannelOption((o) =>
							o
								.setName('to_channel')
								.setDescription('Voice channel to move members to.')
								.setRequired(true)
								.addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice),
						)
						.addStringOption((o) => o.setName('reason').setDescription('Reason for the move.').setRequired(false)),
				),
		);
	}

	// ── Subcommands ──────────────────────────────────────────────────────────

	public async chatInputDeafen(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		if (!interaction.member.permissions.has(PermissionFlagsBits.DeafenMembers)) {
			return interaction.editReply(errorReply('You need the **Deafen Members** permission to use this subcommand.'));
		}

		const target = interaction.options.getMember('user') as GuildMember | null;
		if (!target) return interaction.editReply(errorReply('That user is not in this server.'));

		const reason = interaction.options.getString('reason') ?? 'No reason provided';
		const undeafen = interaction.options.getBoolean('undeafen') ?? false;
		const guild = interaction.guild;

		const h = checkHierarchy(interaction.member, target);
		if (!h.ok) return interaction.editReply(errorReply(h.reason));

		try {
			await target.voice.setDeaf(!undeafen, `[${interaction.user.username}] VC Deafen — ${reason}`);

			const actionWord = undeafen ? 'undeafened' : 'deafened';
			const dm = makeContainer({
				color: undeafen ? Colors.Success : Colors.Moderation,
				header: `You were server-${actionWord} in ${guild.name}`,
			});
			dm.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Reason** ${reason}`));
			await target.send({ components: [dm], flags: CV2_FLAG }).catch(() => null);

			await sendModLog(
				guild,
				logContainer({
					title: `Voice Server ${undeafen ? 'Undeafen' : 'Deafen'}`,
					color: undeafen ? Colors.Success : Colors.Moderation,
					fields: [
						{ name: 'User', value: `${userMention(target.id)} (${target.user.username})` },
						{ name: 'Reason', value: reason },
						{ name: 'Moderator', value: `${userMention(interaction.user.id)} (${interaction.user.username})` },
					],
					timestamp: true,
				}),
			).catch(() => null);

			return interaction.editReply(successReply(`**${target.user.username}** has been server-${actionWord}.`));
		} catch (err) {
			this.container.logger.error(err);
			return interaction.editReply(
				errorReply('Failed to modify the user. Check my permissions or if they are in a voice channel.'),
			);
		}
	}

	public async chatInputDeafenAll(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		if (!interaction.member.permissions.has(PermissionFlagsBits.DeafenMembers)) {
			return interaction.editReply(errorReply('You need the **Deafen Members** permission to use this subcommand.'));
		}

		const channel = interaction.options.getChannel('channel', true);
		const reason = interaction.options.getString('reason') ?? 'No reason provided';
		const guild = interaction.guild;

		const voiceChannel = await guild.channels.fetch(channel.id).catch(() => null);
		if (!voiceChannel || !voiceChannel.isVoiceBased()) {
			return interaction.editReply(errorReply('Channel not found or is not voice-based.'));
		}

		const members = [...voiceChannel.members.values()];
		if (members.length === 0) {
			return interaction.editReply(errorReply(`There are no members in <#${channel.id}>.`));
		}

		let modifiedCount = 0;
		const promises = members.map(async (member) => {
			try {
				if (!member.voice.deaf) {
					await member.voice.setDeaf(true, `[${interaction.user.username}] VC Deafen All — ${reason}`);
					modifiedCount++;
				}
			} catch {
				// Ignore
			}
		});

		await Promise.all(promises);

		if (modifiedCount === 0) {
			return interaction.editReply(errorReply('Failed to deafen anyone, or everyone is already deafened.'));
		}

		await sendModLog(
			guild,
			logContainer({
				title: 'Voice Deafen All',
				color: Colors.Moderation,
				fields: [
					{ name: 'Channel', value: `<#${channel.id}>` },
					{ name: 'Members Deafened', value: `${modifiedCount}` },
					{ name: 'Reason', value: reason },
					{ name: 'Moderator', value: `${userMention(interaction.user.id)} (${interaction.user.username})` },
				],
				timestamp: true,
			}),
		).catch(() => null);

		return interaction.editReply(
			successReply(`Successfully server-deafened **${modifiedCount}** member(s) in <#${channel.id}>.`),
		);
	}

	public async chatInputUndeafenAll(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		if (!interaction.member.permissions.has(PermissionFlagsBits.DeafenMembers)) {
			return interaction.editReply(errorReply('You need the **Deafen Members** permission to use this subcommand.'));
		}

		const channel = interaction.options.getChannel('channel', true);
		const reason = interaction.options.getString('reason') ?? 'No reason provided';
		const guild = interaction.guild;

		const voiceChannel = await guild.channels.fetch(channel.id).catch(() => null);
		if (!voiceChannel || !voiceChannel.isVoiceBased()) {
			return interaction.editReply(errorReply('Channel not found or is not voice-based.'));
		}

		const members = [...voiceChannel.members.values()];
		if (members.length === 0) {
			return interaction.editReply(errorReply(`There are no members in <#${channel.id}>.`));
		}

		let modifiedCount = 0;
		const promises = members.map(async (member) => {
			try {
				if (member.voice.deaf) {
					await member.voice.setDeaf(false, `[${interaction.user.username}] VC Undeafen All — ${reason}`);
					modifiedCount++;
				}
			} catch {
				// Ignore
			}
		});

		await Promise.all(promises);

		if (modifiedCount === 0) {
			return interaction.editReply(errorReply('Failed to undeafen anyone, or everyone is already undeafened.'));
		}

		await sendModLog(
			guild,
			logContainer({
				title: 'Voice Undeafen All',
				color: Colors.Success,
				fields: [
					{ name: 'Channel', value: `<#${channel.id}>` },
					{ name: 'Members Undeafened', value: `${modifiedCount}` },
					{ name: 'Reason', value: reason },
					{ name: 'Moderator', value: `${userMention(interaction.user.id)} (${interaction.user.username})` },
				],
				timestamp: true,
			}),
		).catch(() => null);

		return interaction.editReply(
			successReply(`Successfully server-undeafened **${modifiedCount}** member(s) in <#${channel.id}>.`),
		);
	}

	public async chatInputMute(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		if (!interaction.member.permissions.has(PermissionFlagsBits.MuteMembers)) {
			return interaction.editReply(errorReply('You need the **Mute Members** permission to use this subcommand.'));
		}

		const target = interaction.options.getMember('user') as GuildMember | null;
		if (!target) return interaction.editReply(errorReply('That user is not in this server.'));

		const reason = interaction.options.getString('reason') ?? 'No reason provided';
		const unmute = interaction.options.getBoolean('unmute') ?? false;
		const guild = interaction.guild;

		const h = checkHierarchy(interaction.member, target);
		if (!h.ok) return interaction.editReply(errorReply(h.reason));

		try {
			await target.voice.setMute(!unmute, `[${interaction.user.username}] VC Mute — ${reason}`);

			const actionWord = unmute ? 'unmuted' : 'muted';
			const dm = makeContainer({
				color: unmute ? Colors.Success : Colors.Moderation,
				header: `You were server-${actionWord} in ${guild.name}`,
			});
			dm.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Reason** ${reason}`));
			await target.send({ components: [dm], flags: CV2_FLAG }).catch(() => null);

			await sendModLog(
				guild,
				logContainer({
					title: `Voice Server ${unmute ? 'Unmute' : 'Mute'}`,
					color: unmute ? Colors.Success : Colors.Moderation,
					fields: [
						{ name: 'User', value: `${userMention(target.id)} (${target.user.username})` },
						{ name: 'Reason', value: reason },
						{ name: 'Moderator', value: `${userMention(interaction.user.id)} (${interaction.user.username})` },
					],
					timestamp: true,
				}),
			).catch(() => null);

			return interaction.editReply(successReply(`**${target.user.username}** has been server-${actionWord}.`));
		} catch (err) {
			this.container.logger.error(err);
			return interaction.editReply(
				errorReply('Failed to modify the user. Check my permissions or if they are in a voice channel.'),
			);
		}
	}

	public async chatInputMuteAll(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		if (!interaction.member.permissions.has(PermissionFlagsBits.MuteMembers)) {
			return interaction.editReply(errorReply('You need the **Mute Members** permission to use this subcommand.'));
		}

		const channel = interaction.options.getChannel('channel', true);
		const reason = interaction.options.getString('reason') ?? 'No reason provided';
		const guild = interaction.guild;

		const voiceChannel = await guild.channels.fetch(channel.id).catch(() => null);
		if (!voiceChannel || !voiceChannel.isVoiceBased()) {
			return interaction.editReply(errorReply('Channel not found or is not voice-based.'));
		}

		const members = [...voiceChannel.members.values()];
		if (members.length === 0) {
			return interaction.editReply(errorReply(`There are no members in <#${channel.id}>.`));
		}

		let modifiedCount = 0;
		const promises = members.map(async (member) => {
			try {
				if (!member.voice.mute) {
					await member.voice.setMute(true, `[${interaction.user.username}] VC Mute All — ${reason}`);
					modifiedCount++;
				}
			} catch {
				// Ignore
			}
		});

		await Promise.all(promises);

		if (modifiedCount === 0) {
			return interaction.editReply(errorReply('Failed to mute anyone, or everyone is already muted.'));
		}

		await sendModLog(
			guild,
			logContainer({
				title: 'Voice Mute All',
				color: Colors.Moderation,
				fields: [
					{ name: 'Channel', value: `<#${channel.id}>` },
					{ name: 'Members Muted', value: `${modifiedCount}` },
					{ name: 'Reason', value: reason },
					{ name: 'Moderator', value: `${userMention(interaction.user.id)} (${interaction.user.username})` },
				],
				timestamp: true,
			}),
		).catch(() => null);

		return interaction.editReply(
			successReply(`Successfully server-muted **${modifiedCount}** member(s) in <#${channel.id}>.`),
		);
	}

	public async chatInputUnmuteAll(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		if (!interaction.member.permissions.has(PermissionFlagsBits.MuteMembers)) {
			return interaction.editReply(errorReply('You need the **Mute Members** permission to use this subcommand.'));
		}

		const channel = interaction.options.getChannel('channel', true);
		const reason = interaction.options.getString('reason') ?? 'No reason provided';
		const guild = interaction.guild;

		const voiceChannel = await guild.channels.fetch(channel.id).catch(() => null);
		if (!voiceChannel || !voiceChannel.isVoiceBased()) {
			return interaction.editReply(errorReply('Channel not found or is not voice-based.'));
		}

		const members = [...voiceChannel.members.values()];
		if (members.length === 0) {
			return interaction.editReply(errorReply(`There are no members in <#${channel.id}>.`));
		}

		let modifiedCount = 0;
		const promises = members.map(async (member) => {
			try {
				if (member.voice.mute) {
					await member.voice.setMute(false, `[${interaction.user.username}] VC Unmute All — ${reason}`);
					modifiedCount++;
				}
			} catch {
				// Ignore
			}
		});

		await Promise.all(promises);

		if (modifiedCount === 0) {
			return interaction.editReply(errorReply('Failed to unmute anyone, or everyone is already unmuted.'));
		}

		await sendModLog(
			guild,
			logContainer({
				title: 'Voice Unmute All',
				color: Colors.Success,
				fields: [
					{ name: 'Channel', value: `<#${channel.id}>` },
					{ name: 'Members Unmuted', value: `${modifiedCount}` },
					{ name: 'Reason', value: reason },
					{ name: 'Moderator', value: `${userMention(interaction.user.id)} (${interaction.user.username})` },
				],
				timestamp: true,
			}),
		).catch(() => null);

		return interaction.editReply(
			successReply(`Successfully server-unmuted **${modifiedCount}** member(s) in <#${channel.id}>.`),
		);
	}

	public async chatInputKick(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		if (!interaction.member.permissions.has(PermissionFlagsBits.MoveMembers)) {
			return interaction.editReply(errorReply('You need the **Move Members** permission to use this subcommand.'));
		}

		const target = interaction.options.getMember('user') as GuildMember | null;
		if (!target) return interaction.editReply(errorReply('That user is not in this server.'));

		if (!target.voice.channelId) {
			return interaction.editReply(errorReply('That user is not currently in a voice channel.'));
		}

		const reason = interaction.options.getString('reason') ?? 'No reason provided';
		const guild = interaction.guild;

		const h = checkHierarchy(interaction.member, target);
		if (!h.ok) return interaction.editReply(errorReply(h.reason));

		try {
			await target.voice.disconnect(`[${interaction.user.username}] VC Kick — ${reason}`);

			const dm = makeContainer({
				color: Colors.Moderation,
				header: `You were disconnected from voice in ${guild.name}`,
			});
			dm.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Reason** ${reason}`));
			await target.send({ components: [dm], flags: CV2_FLAG }).catch(() => null);

			await sendModLog(
				guild,
				logContainer({
					title: 'Voice Disconnect',
					color: Colors.Moderation,
					fields: [
						{ name: 'User', value: `${userMention(target.id)} (${target.user.username})` },
						{ name: 'Reason', value: reason },
						{ name: 'Moderator', value: `${userMention(interaction.user.id)} (${interaction.user.username})` },
					],
					timestamp: true,
				}),
			).catch(() => null);

			return interaction.editReply(successReply(`**${target.user.username}** has been disconnected from voice.`));
		} catch (err) {
			this.container.logger.error(err);
			return interaction.editReply(errorReply('Failed to disconnect the user. Check my permissions.'));
		}
	}

	public async chatInputMove(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		if (!interaction.member.permissions.has(PermissionFlagsBits.MoveMembers)) {
			return interaction.editReply(errorReply('You need the **Move Members** permission to use this subcommand.'));
		}

		const target = interaction.options.getMember('user') as GuildMember | null;
		if (!target) return interaction.editReply(errorReply('That user is not in this server.'));

		const channel = interaction.options.getChannel('channel', true);
		const reason = interaction.options.getString('reason') ?? 'No reason provided';
		const guild = interaction.guild;

		if (!target.voice.channel) {
			return interaction.editReply(errorReply('That user is not currently in a voice channel.'));
		}

		const h = checkHierarchy(interaction.member, target);
		if (!h.ok) return interaction.editReply(errorReply(h.reason));

		try {
			await target.voice.setChannel(channel.id, `[${interaction.user.username}] VC Move — ${reason}`);

			await sendModLog(
				guild,
				logContainer({
					title: 'Voice Member Moved',
					color: Colors.Moderation,
					fields: [
						{ name: 'User', value: `${userMention(target.id)} (${target.user.username})` },
						{ name: 'Target Channel', value: `<#${channel.id}>` },
						{ name: 'Reason', value: reason },
						{ name: 'Moderator', value: `${userMention(interaction.user.id)} (${interaction.user.username})` },
					],
					timestamp: true,
				}),
			).catch(() => null);

			return interaction.editReply(successReply(`**${target.user.username}** has been moved to <#${channel.id}>.`));
		} catch (err) {
			this.container.logger.error(err);
			return interaction.editReply(errorReply('Failed to move the member. Check my permissions.'));
		}
	}

	public async chatInputMoveAll(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		if (!interaction.member.permissions.has(PermissionFlagsBits.MoveMembers)) {
			return interaction.editReply(errorReply('You need the **Move Members** permission to use this subcommand.'));
		}

		const fromChannel = interaction.options.getChannel('from_channel', true);
		const toChannel = interaction.options.getChannel('to_channel', true);
		const reason = interaction.options.getString('reason') ?? 'No reason provided';
		const guild = interaction.guild;

		if (fromChannel.id === toChannel.id) {
			return interaction.editReply(errorReply('The source and destination voice channels cannot be the same.'));
		}

		const voiceChannel = await guild.channels.fetch(fromChannel.id).catch(() => null);
		if (!voiceChannel || !voiceChannel.isVoiceBased()) {
			return interaction.editReply(errorReply('Source channel not found or is not voice-based.'));
		}

		const members = [...voiceChannel.members.values()];
		if (members.length === 0) {
			return interaction.editReply(errorReply(`There are no members in <#${fromChannel.id}>.`));
		}

		let movedCount = 0;
		const promises = members.map(async (member) => {
			try {
				await member.voice.setChannel(toChannel.id, `[${interaction.user.username}] VC Move All — ${reason}`);
				movedCount++;
			} catch {
				// Ignore
			}
		});

		await Promise.all(promises);

		if (movedCount === 0) {
			return interaction.editReply(errorReply('Failed to move any members. Check my permissions.'));
		}

		await sendModLog(
			guild,
			logContainer({
				title: 'Voice Mass Move',
				color: Colors.Moderation,
				fields: [
					{ name: 'Source Channel', value: `<#${fromChannel.id}>` },
					{ name: 'Destination Channel', value: `<#${toChannel.id}>` },
					{ name: 'Members Moved', value: `${movedCount}` },
					{ name: 'Reason', value: reason },
					{ name: 'Moderator', value: `${userMention(interaction.user.id)} (${interaction.user.username})` },
				],
				timestamp: true,
			}),
		).catch(() => null);

		return interaction.editReply(
			successReply(`Successfully moved **${movedCount}** member(s) from <#${fromChannel.id}> to <#${toChannel.id}>.`),
		);
	}
}
