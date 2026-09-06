import type { Subcommand } from '@sapphire/plugin-subcommands';
import { MessageFlags, TextDisplayBuilder } from 'discord.js';
import { and, asc, count, eq } from 'drizzle-orm';
import { CV2_FLAG, errorReply, makeContainer, separator, successReply } from '../../../lib/components.js';
import { db, schema } from '../../../lib/database.js';
import { humanDuration, parseDuration } from '../../../lib/parseDuration.js';

const ACTION_LABEL: Record<string, string> = { timeout: '⏱️ Timeout', kick: '👢 Kick', ban: '🔨 Ban' };

export class EscalationHandler {
	public async runAdd(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const threshold = interaction.options.getInteger('threshold', true);
		const action = interaction.options.getString('action', true) as 'timeout' | 'kick' | 'ban';
		const durationStr = interaction.options.getString('duration');

		let durationMs: number | undefined;
		if (action === 'timeout') {
			if (!durationStr) return interaction.editReply(errorReply('Duration is required for timeout action.'));
			const parsed = parseDuration(durationStr);
			if (!parsed) return interaction.editReply(errorReply('Invalid duration. Use formats like `1h`, `1d`.'));
			const maxTimeoutMs = 28 * 24 * 60 * 60 * 1000;
			if (parsed > maxTimeoutMs) return interaction.editReply(errorReply('Max timeout duration is 28 days.'));
			durationMs = parsed;
		}

		await db
			.insert(schema.warnEscalation)
			.values({ guildId: interaction.guildId, threshold, action, durationMs: durationMs ?? null })
			.onDuplicateKeyUpdate({
				set: { action, durationMs: durationMs ?? null },
			});

		const label = `${ACTION_LABEL[action]}${durationMs ? ` (${humanDuration(durationMs)})` : ''}`;
		return interaction.editReply(successReply(`Rule set: **${threshold} warnings** → ${label}.`));
	}

	public async runRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const threshold = interaction.options.getInteger('threshold', true);
		const result = await db
			.delete(schema.warnEscalation)
			.where(
				and(eq(schema.warnEscalation.guildId, interaction.guildId), eq(schema.warnEscalation.threshold, threshold)),
			);
		const affected = Number((result as any)[0]?.affectedRows ?? 0);

		if (affected === 0) return interaction.editReply(errorReply(`No rule at threshold **${threshold}**.`));
		return interaction.editReply(successReply(`Rule at **${threshold} warnings** removed.`));
	}

	public async runTest(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const target = interaction.options.getUser('user', true);

		const [{ warnCount }] = await db
			.select({ warnCount: count() })
			.from(schema.infractions)
			.where(
				and(
					eq(schema.infractions.guildId, interaction.guildId),
					eq(schema.infractions.userId, target.id),
					eq(schema.infractions.type, 'warn'),
				),
			);

		const rules = await db.query.warnEscalation.findMany({
			where: eq(schema.warnEscalation.guildId, interaction.guildId),
			orderBy: [asc(schema.warnEscalation.threshold)],
		});

		const nextRule = rules.find((r) => r.threshold === warnCount + 1);
		const nextRuleAbove = rules.find((r) => r.threshold > warnCount + 1);

		const lines: string[] = [
			`**${target.username}** currently has **${warnCount}** warning${warnCount === 1 ? '' : 's'}.`,
			'',
		];

		if (nextRule) {
			const label = `${ACTION_LABEL[nextRule.action]}${nextRule.durationMs ? ` (${humanDuration(nextRule.durationMs)})` : ''}`;
			lines.push(`🔜 **One more warning (→ ${warnCount + 1}) would trigger:** ${label}`);
		} else {
			lines.push(`*No escalation rule at threshold ${warnCount + 1}.*`);
		}

		if (nextRuleAbove) {
			const label = `${ACTION_LABEL[nextRuleAbove.action]}${nextRuleAbove.durationMs ? ` (${humanDuration(nextRuleAbove.durationMs)})` : ''}`;
			lines.push(`\n*Next rule after that: **${nextRuleAbove.threshold} warnings** → ${label}*`);
		}

		if (rules.length > 0) {
			lines.push('', '**All rules:**');
			for (const r of rules) {
				const label = `${ACTION_LABEL[r.action]}${r.durationMs ? ` (${humanDuration(r.durationMs)})` : ''}`;
				const marker = r.threshold <= warnCount ? '✅' : r.threshold === warnCount + 1 ? '🔜' : '⬜';
				lines.push(`${marker} **${r.threshold}** → ${label}`);
			}
		}

		const c = makeContainer({ header: `Escalation Preview — ${target.username}` });
		c.addSeparatorComponents(separator());
		c.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));

		// biome-ignore lint/suspicious/noExplicitAny: CV2 flag type gap
		return interaction.editReply({ components: [c], flags: (CV2_FLAG | MessageFlags.Ephemeral) as any });
	}

	public async runView(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const rules = await db.query.warnEscalation.findMany({
			where: eq(schema.warnEscalation.guildId, interaction.guildId),
			orderBy: [asc(schema.warnEscalation.threshold)],
		});

		if (!rules.length) {
			return interaction.editReply(errorReply('No escalation rules configured. Use `/escalation add` to create one.'));
		}

		const lines = rules.map((r) => {
			const label = `${ACTION_LABEL[r.action]}${r.durationMs ? ` (${humanDuration(r.durationMs)})` : ''}`;
			return `**${r.threshold} warn${r.threshold === 1 ? '' : 's'}** → ${label}`;
		});

		const c = makeContainer({ header: 'Warn Escalation Rules' });
		c.addSeparatorComponents(separator());
		c.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
		c.addSeparatorComponents(separator());
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent("-# Rules fire when a user's total warning count hits the threshold"),
		);

		// biome-ignore lint/suspicious/noExplicitAny: CV2 flag type gap
		return interaction.editReply({ components: [c], flags: (CV2_FLAG | MessageFlags.Ephemeral) as any });
	}
}
