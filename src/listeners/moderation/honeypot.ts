import { ApplyOptions } from '@sapphire/decorators';
import { Events, Listener } from '@sapphire/framework';
import { type Message, PermissionFlagsBits, TextDisplayBuilder } from 'discord.js';
import { eq } from 'drizzle-orm';
import { Colors, CV2_FLAG, makeContainer } from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';
import { applyWarnEscalation, createInfraction, dispatchModLog } from '../../lib/ModerationUtil.js';
import { humanDuration } from '../../lib/parseDuration.js';

@ApplyOptions<Listener.Options>({
	name: 'honeypotMessageListener',
	event: Events.MessageCreate,
})
export class HoneypotMessageListener extends Listener {
	public override async run(message: Message) {
		if (!message.guild || message.author.bot) return;

		// Check if the author is a moderator or admin
		if (message.member) {
			const perms = BigInt(message.member.permissions.bitfield);
			if ((perms & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator) return;
			const modPerms =
				PermissionFlagsBits.ManageGuild |
				PermissionFlagsBits.KickMembers |
				PermissionFlagsBits.BanMembers |
				PermissionFlagsBits.ModerateMembers;
			if ((perms & modPerms) !== 0n) return;
		}

		// Query database for honeypot channel
		const [honeypot] = await db
			.select()
			.from(schema.honeypotChannels)
			.where(eq(schema.honeypotChannels.channelId, message.channel.id))
			.limit(1);

		if (!honeypot) return;

		// Immediately delete the message
		await message.delete().catch(() => null);

		const guild = message.guild;
		const target = message.author;
		const member = message.member;
		if (!member) return; // Ignore if member cannot be resolved

		const reason = `Sent message in honeypot channel (<#${message.channel.id}>)`;

		try {
			if (honeypot.punishment === 'warn') {
				const infraction = await createInfraction({
					guildId: guild.id,
					userId: target.id,
					moderatorId: message.client.user.id,
					type: 'warn',
					reason,
				});

				const dm = makeContainer({ color: Colors.Warning, header: `You received a warning in ${guild.name}` });
				dm.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(`**Reason** ${reason}\n-# Case \`${infraction.caseId}\``),
				);
				await member.send({ components: [dm], flags: CV2_FLAG as any }).catch(() => null);

				await dispatchModLog({
					guild,
					targetUser: target,
					moderator: message.client.user,
					type: 'warn',
					reason,
					caseId: infraction.caseId,
				});

				await applyWarnEscalation(guild, target, message.client as any, infraction.caseId);
			} else if (honeypot.punishment === 'timeout') {
				const durationMs = honeypot.duration ?? 24 * 60 * 60 * 1000;

				const dm = makeContainer({ color: Colors.Moderation, header: `You have been timed out in ${guild.name}` });
				dm.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(`**Reason** ${reason}\n-# Duration: **${humanDuration(durationMs)}**`),
				);
				await member.send({ components: [dm], flags: CV2_FLAG as any }).catch(() => null);

				await member.timeout(durationMs, reason);

				const infraction = await createInfraction({
					guildId: guild.id,
					userId: target.id,
					moderatorId: message.client.user.id,
					type: 'timeout',
					reason,
					duration: durationMs,
				});

				await dispatchModLog({
					guild,
					targetUser: target,
					moderator: message.client.user,
					type: 'timeout',
					reason,
					caseId: infraction.caseId,
					duration: durationMs,
				});
			} else if (honeypot.punishment === 'kick') {
				const dm = makeContainer({ color: Colors.Moderation, header: `You have been kicked from ${guild.name}` });
				dm.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Reason** ${reason}`));
				await member.send({ components: [dm], flags: CV2_FLAG as any }).catch(() => null);

				await member.kick(reason);

				const infraction = await createInfraction({
					guildId: guild.id,
					userId: target.id,
					moderatorId: message.client.user.id,
					type: 'kick',
					reason,
				});

				await dispatchModLog({
					guild,
					targetUser: target,
					moderator: message.client.user,
					type: 'kick',
					reason,
					caseId: infraction.caseId,
				});
			} else if (honeypot.punishment === 'ban') {
				const durationMs = honeypot.duration;
				const banLabel = durationMs ? `temporarily banned for **${humanDuration(durationMs)}**` : 'permanently banned';
				const banDmColor = durationMs ? Colors.Moderation : Colors.Error;

				const dm = makeContainer({ color: banDmColor, header: `You have been banned from ${guild.name}` });
				dm.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(`**Reason** ${reason}\n-# You were ${banLabel}.`),
				);
				await member.send({ components: [dm], flags: CV2_FLAG as any }).catch(() => null);

				await guild.bans.create(target.id, {
					reason: `[SYSTEM] ${reason}`,
					deleteMessageSeconds: 0,
				});

				const infraction = await createInfraction({
					guildId: guild.id,
					userId: target.id,
					moderatorId: message.client.user.id,
					type: 'ban',
					reason,
					duration: durationMs ?? undefined,
				});

				if (durationMs) {
					await db.insert(schema.tempbans).values({
						guildId: guild.id,
						userId: target.id,
						expiresAt: new Date(Date.now() + durationMs),
						caseId: infraction.caseId,
					});
				}

				await dispatchModLog({
					guild,
					targetUser: target,
					moderator: message.client.user,
					type: 'ban',
					reason,
					caseId: infraction.caseId,
					duration: durationMs ?? undefined,
				});
			}
		} catch (err) {
			this.container.logger.error(
				`[Honeypot] Failed to punish ${target.tag} (${target.id}) in guild ${guild.name} (${guild.id}):`,
				err,
			);
		}
	}
}
