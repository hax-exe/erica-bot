import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Events, type GuildMember, GuildVerificationLevel, type TextChannel, TextDisplayBuilder } from 'discord.js';
import { eq } from 'drizzle-orm';
import { Colors, CV2_FLAG, makeContainer } from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';

// Per-guild: { timestamps: number[], unlockTimer?: ReturnType<typeof setTimeout>, raidActive: boolean, originalLevel?: GuildVerificationLevel }
const raidState = new Map<
	string,
	{
		timestamps: number[];
		unlockTimer?: ReturnType<typeof setTimeout>;
		active: boolean;
		originalLevel?: GuildVerificationLevel;
	}
>();

@ApplyOptions<Listener.Options>({
	name: 'antiRaidMonitor',
	event: Events.GuildMemberAdd,
})
export class AntiRaidListener extends Listener<typeof Events.GuildMemberAdd> {
	public override async run(member: GuildMember) {
		const cfg = await db.query.antiRaidSettings.findFirst({
			where: eq(schema.antiRaidSettings.guildId, member.guild.id),
		});

		if (!cfg?.enabled) {
			raidState.delete(member.guild.id);
			return;
		}

		const now = Date.now();
		const windowMs = cfg.windowSeconds * 1000;

		let state = raidState.get(member.guild.id);
		if (!state) {
			state = { timestamps: [], active: false };
			raidState.set(member.guild.id, state);
		}

		// Prune old timestamps
		state.timestamps = state.timestamps.filter((t) => now - t < windowMs);
		state.timestamps.push(now);

		// Already in raid mode — apply action to this member too
		if (state.active) {
			await this.applyAction(member, cfg.action);
			return;
		}

		if (state.timestamps.length < cfg.joinThreshold) return;

		// Raid detected
		state.active = true;
		this.container.logger.warn(`[AntiRaid] Raid detected in ${member.guild.name} (${member.guild.id})`);

		// Lock the server
		if (cfg.action === 'lock') {
			state.originalLevel = member.guild.verificationLevel;
			await member.guild.setVerificationLevel(GuildVerificationLevel.VeryHigh, 'Anti-raid lock').catch(() => null);
		}

		// Apply action to the triggering member
		await this.applyAction(member, cfg.action);

		// Send alert
		await this.sendAlert(member, cfg, state.timestamps.length);

		// Schedule auto-unlock
		if (cfg.autoUnlockMinutes > 0) {
			if (state.unlockTimer) clearTimeout(state.unlockTimer);
			state.unlockTimer = setTimeout(
				() => this.unlock(member.guild.id, member.guild),
				cfg.autoUnlockMinutes * 60 * 1000,
			);
		}
	}

	private async applyAction(member: GuildMember, action: string) {
		if (action === 'kick') {
			await member.kick('Anti-raid auto-kick').catch(() => null);
		} else if (action === 'ban') {
			await member.ban({ reason: 'Anti-raid auto-ban', deleteMessageSeconds: 86400 }).catch(() => null);
		}
		// 'lock' action only modifies the guild's verification level, no per-member action needed
	}

	private async sendAlert(member: GuildMember, cfg: typeof schema.antiRaidSettings.$inferSelect, joinCount: number) {
		if (!cfg.logChannelId) return;

		const channel = member.guild.channels.cache.get(cfg.logChannelId) as TextChannel | undefined;
		if (!channel?.isTextBased()) return;

		const c = makeContainer({ color: Colors.Error, header: 'Raid Detected' });
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				[
					`**${joinCount}** accounts joined in **${cfg.windowSeconds}s** — raid threshold exceeded.`,
					`**Action taken:** ${cfg.action}`,
					cfg.autoUnlockMinutes > 0
						? `Auto-unlock in **${cfg.autoUnlockMinutes} min**.`
						: '**Manual unlock required.**',
				].join('\n'),
			),
		);

		const ping = cfg.alertRoleId ? `<@&${cfg.alertRoleId}>` : '';
		if (ping) {
			await channel.send({ content: ping }).catch(() => null);
		}
		// biome-ignore lint/suspicious/noExplicitAny: CV2 flag type gap
		await (channel.send as any)({ components: [c], flags: CV2_FLAG }).catch(() => null);
	}

	private async unlock(_guildId: string, guild: import('discord.js').Guild) {
		await manualUnlock(guild, 'System (Auto-unlock)');
	}
}

export async function manualLock(guild: import('discord.js').Guild, moderatorId: string): Promise<boolean> {
	let state = raidState.get(guild.id);
	if (!state) {
		state = { timestamps: [], active: false };
		raidState.set(guild.id, state);
	}

	if (state.active) return false;

	state.active = true;
	state.originalLevel = guild.verificationLevel;
	await guild
		.setVerificationLevel(GuildVerificationLevel.VeryHigh, `Manual lock by moderator ID: ${moderatorId}`)
		.catch(() => null);

	const cfg = await db.query.antiRaidSettings.findFirst({
		where: eq(schema.antiRaidSettings.guildId, guild.id),
	});

	if (cfg && cfg.autoUnlockMinutes > 0) {
		if (state.unlockTimer) clearTimeout(state.unlockTimer);
		state.unlockTimer = setTimeout(
			() => manualUnlock(guild, 'System (Auto-unlock)'),
			cfg.autoUnlockMinutes * 60 * 1000,
		);
	}

	if (cfg?.logChannelId) {
		const channel = guild.channels.cache.get(cfg.logChannelId) as TextChannel | undefined;
		if (channel?.isTextBased()) {
			const c = makeContainer({ color: Colors.Error, header: 'Manual Raid Lock Activated' });
			c.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(`Server verification level set to **Very High** by <@${moderatorId}>.`),
			);
			await (channel.send as any)({ components: [c], flags: CV2_FLAG }).catch(() => null);
		}
	}

	return true;
}

export async function manualUnlock(guild: import('discord.js').Guild, moderatorNameOrId: string): Promise<boolean> {
	const state = raidState.get(guild.id);
	if (!state) return false;

	if (state.unlockTimer) {
		clearTimeout(state.unlockTimer);
	}

	if (state.originalLevel !== undefined) {
		await guild.setVerificationLevel(state.originalLevel, `Manual unlock by: ${moderatorNameOrId}`).catch(() => null);
	}

	raidState.delete(guild.id);

	const cfg = await db.query.antiRaidSettings.findFirst({
		where: eq(schema.antiRaidSettings.guildId, guild.id),
	});

	if (cfg?.logChannelId) {
		const channel = guild.channels.cache.get(cfg.logChannelId) as TextChannel | undefined;
		if (channel?.isTextBased()) {
			const c = makeContainer({ color: Colors.Success, header: 'Server Unlocked' });
			c.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`Server verification level restored. Manual unlock by **${moderatorNameOrId}**.`,
				),
			);
			await (channel.send as any)({ components: [c], flags: CV2_FLAG }).catch(() => null);
		}
	}

	return true;
}
