import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChannelType,
	ContainerBuilder,
	MessageFlags,
	PermissionFlagsBits,
	SeparatorBuilder,
	SeparatorSpacingSize,
	TextDisplayBuilder,
} from 'discord.js';
import { and, eq } from 'drizzle-orm';
import type { GiveawayBonusRole } from '../../db/schema.js';
import { Colors, CV2_FLAG, errorReply, successReply } from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';
import { autocompleteDuration, DURATION_HINT, humanDuration, parseDuration } from '../../lib/parseDuration.js';

export function buildGiveawayCard(opts: {
	prize: string;
	hostId: string;
	endsAt: Date;
	winnerCount: number;
	entrantCount: number;
	ended: boolean;
	cancelled?: boolean;
	winnerIds?: string[];
	giveawayId: number;
	bonusRoles?: GiveawayBonusRole[];
	requiredRoleId?: string | null;
}): { components: ContainerBuilder[]; flags: number } {
	const {
		prize,
		hostId,
		endsAt,
		winnerCount,
		entrantCount,
		ended,
		cancelled,
		winnerIds,
		giveawayId,
		bonusRoles,
		requiredRoleId,
	} = opts;

	let accentColor: number;
	let headerText: string;
	if (cancelled) {
		accentColor = Colors.Neutral;
		headerText = '### Giveaway — Cancelled';
	} else if (ended) {
		accentColor = Colors.Neutral;
		headerText = '### Giveaway — Ended';
	} else {
		accentColor = 0xf1c40f;
		headerText = '### Giveaway';
	}

	const container = new ContainerBuilder().setAccentColor(accentColor);
	container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText));
	container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

	const infoLines = [
		`**Prize** ${prize}`,
		`**Host** <@${hostId}> · **Winners** ${winnerCount}`,
		ended || cancelled
			? `**Ended** <t:${Math.floor(endsAt.getTime() / 1000)}:R>`
			: `**Ends** <t:${Math.floor(endsAt.getTime() / 1000)}:R>`,
		`**Entries** ${entrantCount}`,
	];
	if (requiredRoleId) infoLines.push(`**Required role** <@&${requiredRoleId}>`);
	if (bonusRoles?.length) {
		const bonusLines = bonusRoles.map((br) => `<@&${br.roleId}> ×${br.multiplier}`);
		infoLines.push(`**Bonus entries** ${bonusLines.join(', ')}`);
	}
	container.addTextDisplayComponents(new TextDisplayBuilder().setContent(infoLines.join('\n')));

	if (!cancelled) {
		if (ended && winnerIds?.length) {
			container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
			container.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`**Winner${winnerIds.length === 1 ? '' : 's'}** ${winnerIds.map((id) => `<@${id}>`).join(', ')}`,
				),
			);
		} else if (ended) {
			container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
			container.addTextDisplayComponents(new TextDisplayBuilder().setContent('-# No valid entries — no winner drawn.'));
		}
	}

	if (!ended && !cancelled) {
		container.addActionRowComponents(
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId(`giveaway:enter:${giveawayId}`)
					.setLabel('Enter Giveaway')
					.setEmoji('🎉')
					.setStyle(ButtonStyle.Primary),
			),
		);
	}

	return { components: [container], flags: CV2_FLAG as any };
}

@ApplyOptions<Subcommand.Options>({
	name: 'giveaway',
	description: 'Manage giveaways.',
	subcommands: [
		{ name: 'start', chatInputRun: 'runStart' },
		{ name: 'end', chatInputRun: 'runEnd' },
		{ name: 'reroll', chatInputRun: 'runReroll' },
		{ name: 'list', chatInputRun: 'runList' },
		{ name: 'cancel', chatInputRun: 'runCancel' },
		{ name: 'entries', chatInputRun: 'runEntries' },
		{ name: 'edit', chatInputRun: 'runEdit' },
	],
})
export class GiveawayCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('giveaway')
				.setDescription('Manage giveaways.')
				.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
				.addSubcommand((sub) =>
					sub
						.setName('start')
						.setDescription('Start a new giveaway.')
						.addStringOption((o) =>
							o.setName('prize').setDescription('What are you giving away?').setRequired(true).setMaxLength(200),
						)
						.addStringOption((o) =>
							o
								.setName('duration')
								.setDescription('How long to run (e.g. 1h, 30m, 2d). Max 7d.')
								.setRequired(true)
								.setAutocomplete(true),
						)
						.addIntegerOption((o) =>
							o
								.setName('winners')
								.setDescription('Number of winners (default 1).')
								.setMinValue(1)
								.setMaxValue(20)
								.setRequired(false),
						)
						.addChannelOption((o) =>
							o
								.setName('channel')
								.setDescription('Channel to post in (defaults to current).')
								.addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
								.setRequired(false),
						)
						.addRoleOption((o) =>
							o.setName('required_role').setDescription('Role required to enter the giveaway.').setRequired(false),
						)
						.addRoleOption((o) =>
							o
								.setName('bonus_role_1')
								.setDescription('Role that gets extra entries (set multiplier below).')
								.setRequired(false),
						)
						.addIntegerOption((o) =>
							o
								.setName('bonus_multiplier_1')
								.setDescription('How many entries bonus_role_1 gets (default 2).')
								.setMinValue(2)
								.setMaxValue(10)
								.setRequired(false),
						)
						.addRoleOption((o) => o.setName('bonus_role_2').setDescription('Second bonus role.').setRequired(false))
						.addIntegerOption((o) =>
							o
								.setName('bonus_multiplier_2')
								.setDescription('Entries for bonus_role_2 (default 2).')
								.setMinValue(2)
								.setMaxValue(10)
								.setRequired(false),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('end')
						.setDescription('End a giveaway early and draw winners.')
						.addIntegerOption((o) =>
							o
								.setName('id')
								.setDescription('Giveaway ID from /giveaway list.')
								.setRequired(true)
								.setAutocomplete(true),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('reroll')
						.setDescription('Reroll winners for an ended giveaway.')
						.addIntegerOption((o) =>
							o
								.setName('id')
								.setDescription('Giveaway ID from /giveaway list.')
								.setRequired(true)
								.setAutocomplete(true),
						),
				)
				.addSubcommand((sub) => sub.setName('list').setDescription('List active giveaways in this server.'))
				.addSubcommand((sub) =>
					sub
						.setName('cancel')
						.setDescription('Cancel a giveaway without drawing winners.')
						.addIntegerOption((o) =>
							o
								.setName('id')
								.setDescription('Giveaway ID from /giveaway list.')
								.setRequired(true)
								.setAutocomplete(true),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('entries')
						.setDescription('Show who has entered a giveaway.')
						.addIntegerOption((o) =>
							o
								.setName('id')
								.setDescription('Giveaway ID from /giveaway list.')
								.setRequired(true)
								.setAutocomplete(true),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('edit')
						.setDescription('Edit a live giveaway.')
						.addIntegerOption((o) =>
							o
								.setName('id')
								.setDescription('Giveaway ID from /giveaway list.')
								.setRequired(true)
								.setAutocomplete(true),
						)
						.addStringOption((o) =>
							o.setName('prize').setDescription('New prize text.').setMaxLength(200).setRequired(false),
						)
						.addStringOption((o) =>
							o
								.setName('extend')
								.setDescription('Extend the end time (e.g. 1h, 30m, 2d).')
								.setRequired(false)
								.setAutocomplete(true),
						)
						.addIntegerOption((o) =>
							o
								.setName('winners')
								.setDescription('New winner count.')
								.setMinValue(1)
								.setMaxValue(20)
								.setRequired(false),
						),
				),
		);
	}

	public override async autocompleteRun(interaction: Subcommand.AutocompleteInteraction) {
		const focused = interaction.options.getFocused(true);
		if (focused.name === 'duration' || focused.name === 'extend') {
			return interaction.respond(autocompleteDuration(focused.value));
		}
		if (focused.name === 'id' && interaction.inCachedGuild()) {
			const sub = interaction.options.getSubcommand(false);
			const q = focused.value.toString().toLowerCase();
			const rows = await db.query.giveaways.findMany({
				where: eq(schema.giveaways.guildId, interaction.guildId),
				limit: 40,
			});
			const filtered = rows
				.filter((g) => {
					if (sub === 'reroll') return g.ended && !g.cancelled;
					if (sub === 'end' || sub === 'cancel' || sub === 'edit' || sub === 'entries') {
						return !g.ended && !g.cancelled;
					}
					return !g.cancelled;
				})
				.filter((g) => !q || String(g.id).includes(q) || g.prize.toLowerCase().includes(q))
				.slice(0, 25)
				.map((g) => ({
					name: `#${g.id} — ${g.prize}`.slice(0, 100),
					value: g.id,
				}));
			return interaction.respond(filtered);
		}
		return interaction.respond([]);
	}

	public async runStart(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));
		if (!(await isModuleEnabled(interaction.guildId, 'giveaways')))
			return interaction.editReply(errorReply('Giveaways module is disabled.'));

		const prize = interaction.options.getString('prize', true);
		const durationStr = interaction.options.getString('duration', true);
		const winnerCount = interaction.options.getInteger('winners') ?? 1;
		const targetChannel = interaction.options.getChannel('channel') ?? interaction.channel;
		if (!targetChannel?.isTextBased()) return interaction.editReply(errorReply('Invalid channel.'));

		const durationMs = parseDuration(durationStr);
		if (!durationMs) return interaction.editReply(errorReply(`Invalid duration. ${DURATION_HINT}`));
		const maxMs = 7 * 24 * 60 * 60 * 1000;
		if (durationMs > maxMs) return interaction.editReply(errorReply('Max duration is 7 days.'));

		const endsAt = new Date(Date.now() + durationMs);
		const requiredRole = interaction.options.getRole('required_role');

		const bonusRoles: GiveawayBonusRole[] = [];
		for (const n of [1, 2] as const) {
			const role = interaction.options.getRole(`bonus_role_${n}`);
			if (!role) continue;
			const multiplier = interaction.options.getInteger(`bonus_multiplier_${n}`) ?? 2;
			bonusRoles.push({ roleId: role.id, multiplier });
		}

		const [idRow] = await db
			.insert(schema.giveaways)
			.values({
				guildId: interaction.guildId,
				channelId: targetChannel.id,
				messageId: '0',
				prize,
				winnerCount,
				hostId: interaction.user.id,
				endsAt,
				bonusRoles: JSON.stringify(bonusRoles),
				requiredRoleId: requiredRole?.id ?? null,
			})
			.$returningId();
		const [row] = await db.select().from(schema.giveaways).where(eq(schema.giveaways.id, idRow.id)).limit(1);
		if (!row) return interaction.editReply(errorReply('Failed to create giveaway.'));

		const card = buildGiveawayCard({
			prize,
			hostId: interaction.user.id,
			endsAt,
			winnerCount,
			entrantCount: 0,
			ended: false,
			giveawayId: row.id,
			bonusRoles,
			requiredRoleId: requiredRole?.id,
		});

		const msg = await (targetChannel as import('discord.js').TextChannel).send(card as any);
		await db.update(schema.giveaways).set({ messageId: msg.id }).where(eq(schema.giveaways.id, row.id));

		return interaction.editReply(
			successReply(
				`Giveaway started! Ends in **${humanDuration(durationMs)}** in <#${targetChannel.id}>. ID: \`${row.id}\``,
			),
		);
	}

	public async runEnd(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const id = interaction.options.getInteger('id', true);
		const giveaway = await db.query.giveaways.findFirst({
			where: and(eq(schema.giveaways.id, id), eq(schema.giveaways.guildId, interaction.guildId)),
		});
		if (!giveaway) return interaction.editReply(errorReply(`No giveaway with ID \`${id}\` found.`));
		if (giveaway.ended) return interaction.editReply(errorReply('That giveaway has already ended.'));
		if (giveaway.cancelled) return interaction.editReply(errorReply('That giveaway has been cancelled.'));

		await endGiveaway(giveaway, interaction.client);
		return interaction.editReply(successReply('Giveaway ended and winners drawn.'));
	}

	public async runReroll(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const id = interaction.options.getInteger('id', true);
		const giveaway = await db.query.giveaways.findFirst({
			where: and(eq(schema.giveaways.id, id), eq(schema.giveaways.guildId, interaction.guildId)),
		});
		if (!giveaway) return interaction.editReply(errorReply(`No giveaway with ID \`${id}\` found.`));
		if (!giveaway.ended)
			return interaction.editReply(errorReply('That giveaway has not ended yet. Use `/giveaway end` first.'));

		const entrants = JSON.parse(giveaway.entrantIds) as string[];
		if (!entrants.length) return interaction.editReply(errorReply('No entries to reroll from.'));

		const winners = pickWinners(entrants, giveaway.winnerCount);
		await db
			.update(schema.giveaways)
			.set({ winnerIds: JSON.stringify(winners) })
			.where(eq(schema.giveaways.id, id));

		try {
			const guild = interaction.guild;
			const channel = guild.channels.cache.get(giveaway.channelId) as import('discord.js').TextChannel | undefined;
			if (channel) {
				const msg = await channel.messages.fetch(giveaway.messageId).catch(() => null);
				if (msg) {
					await msg.edit(
						buildGiveawayCard({
							prize: giveaway.prize,
							hostId: giveaway.hostId,
							endsAt: giveaway.endsAt,
							winnerCount: giveaway.winnerCount,
							entrantCount: entrants.length,
							ended: true,
							winnerIds: winners,
							giveawayId: giveaway.id,
							requiredRoleId: giveaway.requiredRoleId,
						}) as any,
					);
				}
				await channel.send(
					`🎉 Reroll! Congratulations ${winners.map((id) => `<@${id}>`).join(', ')}! You won **${giveaway.prize}**!`,
				);
			}
		} catch {
			// Non-fatal if message update fails
		}

		return interaction.editReply(successReply(`Rerolled! New winners: ${winners.map((id) => `<@${id}>`).join(', ')}`));
	}

	public async runList(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const active = await db.query.giveaways.findMany({
			where: and(
				eq(schema.giveaways.guildId, interaction.guildId),
				eq(schema.giveaways.ended, false),
				eq(schema.giveaways.cancelled, false),
			),
		});

		if (!active.length) return interaction.editReply(errorReply('No active giveaways.'));

		const lines = active.map(
			(g) =>
				`\`#${g.id}\` **${g.prize}** — ${g.winnerCount} winner${g.winnerCount === 1 ? '' : 's'} — ends <t:${Math.floor(g.endsAt.getTime() / 1000)}:R> in <#${g.channelId}>`,
		);

		const container = new ContainerBuilder().setAccentColor(0xf1c40f);
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(`### Active Giveaways\n${lines.join('\n')}`),
		);
		container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(`-# ${active.length} active • Use \`/giveaway end <id>\` to end early`),
		);

		return interaction.editReply({ components: [container], flags: (CV2_FLAG | MessageFlags.Ephemeral) as any });
	}

	public async runCancel(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const id = interaction.options.getInteger('id', true);
		const giveaway = await db.query.giveaways.findFirst({
			where: and(eq(schema.giveaways.id, id), eq(schema.giveaways.guildId, interaction.guildId)),
		});
		if (!giveaway) return interaction.editReply(errorReply(`No giveaway with ID \`${id}\` found.`));
		if (giveaway.ended) return interaction.editReply(errorReply('That giveaway has already ended.'));
		if (giveaway.cancelled) return interaction.editReply(errorReply('That giveaway is already cancelled.'));

		await db.update(schema.giveaways).set({ ended: true, cancelled: true }).where(eq(schema.giveaways.id, id));

		try {
			const channel = interaction.guild.channels.cache.get(giveaway.channelId) as
				| import('discord.js').TextChannel
				| undefined;
			if (channel) {
				const msg = await channel.messages.fetch(giveaway.messageId).catch(() => null);
				if (msg) {
					await msg.edit(
						buildGiveawayCard({
							prize: giveaway.prize,
							hostId: giveaway.hostId,
							endsAt: giveaway.endsAt,
							winnerCount: giveaway.winnerCount,
							entrantCount: (JSON.parse(giveaway.entrantIds) as string[]).length,
							ended: true,
							cancelled: true,
							giveawayId: giveaway.id,
							requiredRoleId: giveaway.requiredRoleId,
						}) as any,
					);
				}
			}
		} catch {
			// Non-fatal
		}

		return interaction.editReply(successReply(`Giveaway \`#${id}\` cancelled.`));
	}

	public async runEntries(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const id = interaction.options.getInteger('id', true);
		const giveaway = await db.query.giveaways.findFirst({
			where: and(eq(schema.giveaways.id, id), eq(schema.giveaways.guildId, interaction.guildId)),
		});
		if (!giveaway) return interaction.editReply(errorReply(`No giveaway with ID \`${id}\` found.`));

		const entrants = JSON.parse(giveaway.entrantIds) as string[];
		const SHOW_LIMIT = 50;
		const shown = entrants.slice(0, SHOW_LIMIT);
		const overflow = entrants.length - shown.length;

		let body: string;
		if (!entrants.length) {
			body = `### Entries for #${id} — ${giveaway.prize}\nNo entries yet.`;
		} else {
			const list = shown.map((uid, i) => `${i + 1}. <@${uid}>`).join('\n');
			body = `### Entries for #${id} — ${giveaway.prize}\n${list}`;
			if (overflow > 0) body += `\n-# … and ${overflow} more`;
		}

		const container = new ContainerBuilder().setAccentColor(0xf1c40f);
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
		container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(`-# ${entrants.length} total entr${entrants.length === 1 ? 'y' : 'ies'}`),
		);

		return interaction.editReply({ components: [container], flags: (CV2_FLAG | MessageFlags.Ephemeral) as any });
	}

	public async runEdit(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const id = interaction.options.getInteger('id', true);
		const newPrize = interaction.options.getString('prize');
		const extendStr = interaction.options.getString('extend');
		const newWinners = interaction.options.getInteger('winners');

		if (!newPrize && !extendStr && !newWinners)
			return interaction.editReply(errorReply('Provide at least one of: `prize`, `extend`, `winners`.'));

		const giveaway = await db.query.giveaways.findFirst({
			where: and(eq(schema.giveaways.id, id), eq(schema.giveaways.guildId, interaction.guildId)),
		});
		if (!giveaway) return interaction.editReply(errorReply(`No giveaway with ID \`${id}\` found.`));
		if (giveaway.ended) return interaction.editReply(errorReply('Cannot edit an ended or cancelled giveaway.'));

		const updates: Partial<typeof schema.giveaways.$inferInsert> = {};
		const changes: string[] = [];

		if (newPrize) {
			updates.prize = newPrize;
			changes.push(`prize → **${newPrize}**`);
		}
		if (extendStr) {
			const extendMs = parseDuration(extendStr);
			if (!extendMs) return interaction.editReply(errorReply(`Invalid extend duration. ${DURATION_HINT}`));
			updates.endsAt = new Date(giveaway.endsAt.getTime() + extendMs);
			changes.push(`extended by **${humanDuration(extendMs)}**`);
		}
		if (newWinners) {
			updates.winnerCount = newWinners;
			changes.push(`winners → **${newWinners}**`);
		}

		await db.update(schema.giveaways).set(updates).where(eq(schema.giveaways.id, id));

		const updated = { ...giveaway, ...updates };

		try {
			const channel = interaction.guild.channels.cache.get(giveaway.channelId) as
				| import('discord.js').TextChannel
				| undefined;
			if (channel) {
				const msg = await channel.messages.fetch(giveaway.messageId).catch(() => null);
				if (msg) {
					await msg.edit(
						buildGiveawayCard({
							prize: updated.prize,
							hostId: updated.hostId,
							endsAt: updated.endsAt,
							winnerCount: updated.winnerCount,
							entrantCount: (JSON.parse(giveaway.entrantIds) as string[]).length,
							ended: false,
							giveawayId: giveaway.id,
							bonusRoles: JSON.parse(giveaway.bonusRoles),
							requiredRoleId: giveaway.requiredRoleId,
						}) as any,
					);
				}
			}
		} catch {
			// Non-fatal
		}

		return interaction.editReply(successReply(`Giveaway \`#${id}\` updated: ${changes.join(', ')}.`));
	}
}

function buildWeightedPool(
	entrants: string[],
	bonusRoles: GiveawayBonusRole[],
	guild: import('discord.js').Guild | undefined,
): string[] {
	if (!bonusRoles.length || !guild) return [...entrants];
	const pool: string[] = [];
	for (const userId of entrants) {
		const member = guild.members.cache.get(userId);
		let weight = 1;
		if (member) {
			for (const br of bonusRoles) {
				if (member.roles.cache.has(br.roleId)) {
					weight = Math.max(weight, br.multiplier);
				}
			}
		}
		for (let i = 0; i < weight; i++) pool.push(userId);
	}
	return pool;
}

function pickWinners(
	entrants: string[],
	count: number,
	bonusRoles: GiveawayBonusRole[] = [],
	guild?: import('discord.js').Guild,
): string[] {
	const pool = buildWeightedPool(entrants, bonusRoles, guild);
	const winners: string[] = [];
	const pickedUsers = new Set<string>();
	while (winners.length < count && pool.length > 0) {
		const idx = Math.floor(Math.random() * pool.length);
		const userId = pool.splice(idx, 1)[0];
		if (pickedUsers.has(userId)) {
			pool.splice(0, pool.length, ...pool.filter((id) => id !== userId));
			continue;
		}
		pickedUsers.add(userId);
		winners.push(userId);
	}
	return winners;
}

export async function endGiveaway(
	giveaway: typeof schema.giveaways.$inferSelect,
	client: import('discord.js').Client,
): Promise<void> {
	const entrants = JSON.parse(giveaway.entrantIds) as string[];
	const bonusRoles: GiveawayBonusRole[] = JSON.parse(giveaway.bonusRoles);
	const guild = client.guilds.cache.get(giveaway.guildId);
	const winners = pickWinners(entrants, giveaway.winnerCount, bonusRoles, guild);

	// Conditional update prevents double-ending under overlapping scheduler/manual end
	const result = await db
		.update(schema.giveaways)
		.set({ ended: true, winnerIds: JSON.stringify(winners) })
		.where(and(eq(schema.giveaways.id, giveaway.id), eq(schema.giveaways.ended, false)));
	const affected = Number((result as any)[0]?.affectedRows ?? 0);

	if (affected === 0) return;

	try {
		const guild = client.guilds.cache.get(giveaway.guildId);
		if (!guild) return;
		const channel = guild.channels.cache.get(giveaway.channelId) as import('discord.js').TextChannel | undefined;
		if (!channel) return;

		const msg = await channel.messages.fetch(giveaway.messageId).catch(() => null);
		if (msg) {
			await msg.edit(
				buildGiveawayCard({
					prize: giveaway.prize,
					hostId: giveaway.hostId,
					endsAt: giveaway.endsAt,
					winnerCount: giveaway.winnerCount,
					entrantCount: entrants.length,
					ended: true,
					winnerIds: winners,
					giveawayId: giveaway.id,
					requiredRoleId: giveaway.requiredRoleId,
				}) as any,
			);
		}

		if (winners.length > 0) {
			await channel.send(
				`🎉 Congratulations ${winners.map((id) => `<@${id}>`).join(', ')}! You won **${giveaway.prize}**!`,
			);
		} else {
			await channel.send(`🎉 The giveaway for **${giveaway.prize}** has ended with no valid entries.`);
		}
	} catch {
		// Non-fatal
	}
}
