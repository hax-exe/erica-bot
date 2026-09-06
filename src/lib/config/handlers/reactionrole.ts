import type { Subcommand } from '@sapphire/plugin-subcommands';
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ContainerBuilder,
	type Guild,
	MessageFlags,
	StringSelectMenuBuilder,
	StringSelectMenuOptionBuilder,
	TextDisplayBuilder,
} from 'discord.js';
import { and, eq } from 'drizzle-orm';
import { CV2_FLAG, errorReply, makeContainer, separator, successReply } from '../../../lib/components.js';
import { db, schema } from '../../../lib/database.js';

// ─── Types ─────────────────────────────────────────────────────────────────────

type RRPanel = typeof schema.rrPanels.$inferSelect;
type RRPanelRole = typeof schema.rrPanelRoles.$inferSelect;

// ─── Panel builder ─────────────────────────────────────────────────────────────

export function buildRRPanelPayload(panel: RRPanel, roles: RRPanelRole[]) {
	const container = new ContainerBuilder();

	container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${panel.title}`));

	if (panel.description) {
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(panel.description));
	}

	container.addSeparatorComponents(separator());

	if (!roles.length) {
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent('-# No roles have been configured for this panel yet.'),
		);
		return { components: [container], flags: CV2_FLAG };
	}

	if (panel.mode === 'buttons') {
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent('-# Click a button to toggle a role.'));

		// Up to 25 buttons, 5 per row
		const chunks: RRPanelRole[][] = [];
		for (let i = 0; i < roles.length; i += 5) chunks.push(roles.slice(i, i + 5));

		for (const chunk of chunks) {
			const row = new ActionRowBuilder<ButtonBuilder>();
			for (const r of chunk) {
				const btn = new ButtonBuilder()
					.setCustomId(`rr_btn:${panel.id}:${r.roleId}`)
					.setLabel(r.label)
					.setStyle(ButtonStyle.Secondary);
				if (r.emoji) btn.setEmoji(r.emoji);
				row.addComponents(btn);
			}
			container.addActionRowComponents(row);
		}
	} else {
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent('-# Select the roles you want. Deselect all to remove them.'),
		);

		const options = roles.map((r) => {
			const opt = new StringSelectMenuOptionBuilder().setLabel(r.label).setValue(r.roleId);
			if (r.description) opt.setDescription(r.description);
			if (r.emoji) opt.setEmoji(r.emoji);
			return opt;
		});

		const select = new StringSelectMenuBuilder()
			.setCustomId(`rr:${panel.id}`)
			.setPlaceholder('Choose your roles...')
			.setMinValues(0)
			.setMaxValues(Math.min(roles.length, 25))
			.addOptions(options);

		container.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
	}

	return { components: [container], flags: CV2_FLAG };
}

/** Fetch roles for a panel and edit the panel message in-place. */
export async function refreshRRPanel(panel: RRPanel, guild: Guild): Promise<void> {
	const roles = await db.select().from(schema.rrPanelRoles).where(eq(schema.rrPanelRoles.panelId, panel.id));

	const channel = guild.channels.cache.get(panel.channelId);
	if (!channel?.isTextBased()) return;

	const msg = await channel.messages.fetch(panel.messageId).catch(() => null);
	if (!msg) return;

	// biome-ignore lint/suspicious/noExplicitAny: CV2 payload type gap
	await msg.edit(buildRRPanelPayload(panel, roles) as any).catch(() => null);
}

// ─── Command ───────────────────────────────────────────────────────────────────

export class ReactionRoleHandler {
	// ── /reactionrole panel ────────────────────────────────────────────────────

	public async chatInputPanel(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const channel = interaction.options.getChannel('channel', true);
		const title = interaction.options.getString('title') ?? 'Role Selection';
		const description = interaction.options.getString('description');
		const mode = (interaction.options.getString('mode') ?? 'select') as 'select' | 'buttons';

		const textChannel = interaction.guild.channels.cache.get(channel.id);
		if (!textChannel?.isTextBased()) return interaction.editReply(errorReply('Invalid channel.'));

		const placeholder: RRPanel = {
			id: 0,
			guildId: interaction.guildId,
			channelId: channel.id,
			messageId: '',
			title,
			description,
			mode,
		};
		// biome-ignore lint/suspicious/noExplicitAny: CV2 payload type gap
		const msg = await (textChannel.send as any)(buildRRPanelPayload(placeholder, []));

		const [idRow] = await db
			.insert(schema.rrPanels)
			.values({ guildId: interaction.guildId, channelId: channel.id, messageId: msg.id, title, description, mode })
			.$returningId();
		const [panel] = await db.select().from(schema.rrPanels).where(eq(schema.rrPanels.id, idRow.id)).limit(1);
		if (!panel) return interaction.editReply(errorReply('Failed to create panel.'));

		await refreshRRPanel(panel, interaction.guild);

		return interaction.editReply(
			successReply(
				`Panel **#${panel.id}** (${mode}) created in <#${channel.id}>. Use \`/reactionrole add ${panel.id}\` to add roles.`,
			),
		);
	}

	// ── /reactionrole add ──────────────────────────────────────────────────────

	public async chatInputAdd(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const panelId = interaction.options.getInteger('panel_id', true);
		const role = interaction.options.getRole('role', true);
		const label = interaction.options.getString('label', true);
		const description = interaction.options.getString('description');
		const emoji = interaction.options.getString('emoji');

		const panel = await db
			.select()
			.from(schema.rrPanels)
			.where(and(eq(schema.rrPanels.id, panelId), eq(schema.rrPanels.guildId, interaction.guildId)))
			.limit(1)
			.then((r) => r[0] ?? null);

		if (!panel) return interaction.editReply(errorReply(`Panel #${panelId} not found.`));

		const existingRoles = await db.select().from(schema.rrPanelRoles).where(eq(schema.rrPanelRoles.panelId, panelId));
		const limit = panel.mode === 'buttons' ? 25 : 25;

		if (existingRoles.length >= limit) {
			return interaction.editReply(errorReply(`Panels can have at most ${limit} roles.`));
		}
		if (existingRoles.some((r) => r.roleId === role.id)) {
			return interaction.editReply(errorReply('That role is already on this panel.'));
		}

		await db.insert(schema.rrPanelRoles).values({ panelId, roleId: role.id, label, description, emoji });
		await refreshRRPanel(panel, interaction.guild);

		return interaction.editReply(successReply(`Added <@&${role.id}> to panel **#${panelId}**.`));
	}

	// ── /reactionrole remove ───────────────────────────────────────────────────

	public async chatInputRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const panelId = interaction.options.getInteger('panel_id', true);
		const role = interaction.options.getRole('role', true);

		const panel = await db
			.select()
			.from(schema.rrPanels)
			.where(and(eq(schema.rrPanels.id, panelId), eq(schema.rrPanels.guildId, interaction.guildId)))
			.limit(1)
			.then((r) => r[0] ?? null);

		if (!panel) return interaction.editReply(errorReply(`Panel #${panelId} not found.`));

		const existing = await db
			.select()
			.from(schema.rrPanelRoles)
			.where(and(eq(schema.rrPanelRoles.panelId, panelId), eq(schema.rrPanelRoles.roleId, role.id)))
			.limit(1)
			.then((r) => r[0] ?? null);

		if (!existing) return interaction.editReply(errorReply('That role is not on this panel.'));

		await db
			.delete(schema.rrPanelRoles)
			.where(and(eq(schema.rrPanelRoles.panelId, panelId), eq(schema.rrPanelRoles.roleId, role.id)));

		await refreshRRPanel(panel, interaction.guild);

		return interaction.editReply(successReply(`Removed <@&${role.id}> from panel **#${panelId}**.`));
	}

	// ── /reactionrole list ─────────────────────────────────────────────────────

	public async chatInputList(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const panels = await db.select().from(schema.rrPanels).where(eq(schema.rrPanels.guildId, interaction.guildId));

		if (!panels.length) return interaction.editReply(successReply('No role panels configured.'));

		const container = makeContainer({ header: 'Role Panels' });
		container.addSeparatorComponents(separator());

		for (const p of panels) {
			const roles = await db.select().from(schema.rrPanelRoles).where(eq(schema.rrPanelRoles.panelId, p.id));

			container.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`**#${p.id}** — ${p.title} • <#${p.channelId}> • ${p.mode} • ${roles.length} role(s)\n-# msg \`${p.messageId}\``,
				),
			);
		}

		return interaction.editReply({
			components: [container],
			flags: (CV2_FLAG | MessageFlags.Ephemeral) as never,
		});
	}

	// ── /reactionrole delete ───────────────────────────────────────────────────

	public async chatInputDelete(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const panelId = interaction.options.getInteger('panel_id', true);

		const panel = await db
			.select()
			.from(schema.rrPanels)
			.where(and(eq(schema.rrPanels.id, panelId), eq(schema.rrPanels.guildId, interaction.guildId)))
			.limit(1)
			.then((r) => r[0] ?? null);

		if (!panel) return interaction.editReply(errorReply(`Panel #${panelId} not found.`));

		const channel = interaction.guild.channels.cache.get(panel.channelId);
		if (channel?.isTextBased()) {
			const msg = await channel.messages.fetch(panel.messageId).catch(() => null);
			await msg?.delete().catch(() => null);
		}

		await db.delete(schema.rrPanelRoles).where(eq(schema.rrPanelRoles.panelId, panelId));
		await db.delete(schema.rrPanels).where(eq(schema.rrPanels.id, panelId));

		return interaction.editReply(successReply(`Panel **#${panelId}** deleted.`));
	}
}
