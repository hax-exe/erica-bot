import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	Events,
	type Interaction,
	SeparatorBuilder,
	SeparatorSpacingSize,
	StringSelectMenuBuilder,
	StringSelectMenuOptionBuilder,
	TextDisplayBuilder,
	userMention,
} from 'discord.js';
import { isBotBlacklisted } from '../lib/BlacklistUtil.js';
import { Colors, cv2Reply, field, makeContainer, pageNavRow, separator } from '../lib/components.js';
import { getInfractions } from '../lib/ModerationUtil.js';

function titleCaseType(type: string): string {
	return type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
}

export async function buildActiveTimeoutsPage(
	guild: import('discord.js').Guild,
	page: number,
	searchUserId?: string | null,
) {
	const members = await guild.members.fetch().catch(() => null);
	if (!members) {
		const c = makeContainer({ color: Colors.Error });
		c.addTextDisplayComponents(new TextDisplayBuilder().setContent('Failed to fetch member list.'));
		return cv2Reply(c, true);
	}

	const now = Date.now();
	let timedOut = Array.from(members.values())
		.filter((m) => !!m.communicationDisabledUntilTimestamp && m.communicationDisabledUntilTimestamp > now)
		.sort((a, b) => (a.communicationDisabledUntilTimestamp ?? 0) - (b.communicationDisabledUntilTimestamp ?? 0));

	if (searchUserId && searchUserId !== 'all') {
		timedOut = timedOut.filter((m) => m.id === searchUserId);
	}

	const container = makeContainer({
		color: timedOut.length === 0 ? Colors.Success : Colors.Moderation,
		header: `Active Timeouts (${timedOut.length})`,
	});

	if (timedOut.length === 0) {
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent('No members are currently timed out.'));
		return cv2Reply(container, true);
	}

	container.addSeparatorComponents(separator());

	const PAGE_SIZE = 5;
	const totalPages = Math.ceil(timedOut.length / PAGE_SIZE) || 1;
	if (page < 0) page = 0;
	if (page >= totalPages) page = totalPages - 1;

	const slice = timedOut.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

	for (const member of slice) {
		const expiresAt = Math.floor((member.communicationDisabledUntilTimestamp ?? 0) / 1000);
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`${userMention(member.id)} **${member.user.username}**\n` +
					`-# Expires <t:${expiresAt}:R> (<t:${expiresAt}:f>)`,
			),
		);
		container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
	}

	container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Page ${page + 1} of ${totalPages}`));

	if (totalPages > 1) {
		const searchVal = searchUserId || 'all';
		container.addActionRowComponents(
			pageNavRow(`page:timeouts:${searchVal}:${page - 1}`, `page:timeouts:${searchVal}:${page + 1}`, {
				atStart: page === 0,
				atEnd: page === totalPages - 1,
			}),
		);
	}

	const selectMenu = new StringSelectMenuBuilder()
		.setCustomId('mod:untimeout_select')
		.setPlaceholder('Select a member…');

	selectMenu.addOptions(
		slice.map((m) =>
			new StringSelectMenuOptionBuilder()
				.setLabel(m.user.username.slice(0, 50))
				.setDescription(`ID: ${m.id}`)
				.setValue(m.id)
				.setEmoji('🔊'),
		),
	);

	container.addActionRowComponents(new ActionRowBuilder<any>().addComponents(selectMenu));

	return cv2Reply(container, true);
}

export async function buildTagsPage(guildId: string, page: number) {
	const { db, schema } = await import('../lib/database.js');
	const { eq } = await import('drizzle-orm');

	const rows = await db
		.select({ name: schema.tags.name, aliases: schema.tags.aliases })
		.from(schema.tags)
		.where(eq(schema.tags.guildId, guildId));

	if (rows.length === 0) {
		const { warningReply } = await import('../lib/components.js');
		return warningReply('No tags configured for this server. Use `/tag-manage create` to add one.');
	}

	const PAGE_SIZE = 15;
	const totalPages = Math.ceil(rows.length / PAGE_SIZE) || 1;
	if (page < 0) page = 0;
	if (page >= totalPages) page = totalPages - 1;

	const slice = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

	const lines = slice.map((r) => {
		const aliases = JSON.parse(r.aliases) as string[];
		const aliasPart = aliases.length > 0 ? ` *(${aliases.map((a) => `\`${a}\``).join(', ')})*` : '';
		return `\`${r.name}\`${aliasPart}`;
	});

	const container = makeContainer({ color: Colors.Info, header: `Tags (${rows.length})` });
	container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));

	if (totalPages > 1) {
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Page ${page + 1} of ${totalPages}`));
		container.addActionRowComponents(
			pageNavRow(`page:tags:list:${page - 1}`, `page:tags:list:${page + 1}`, {
				atStart: page === 0,
				atEnd: page === totalPages - 1,
			}),
		);
	}

	return cv2Reply(container, true);
}

export async function buildWarningsPage(guildId: string, targetId: string, username: string, page: number) {
	const infractions = await getInfractions(guildId, targetId);

	const container = makeContainer({
		color: infractions.length === 0 ? Colors.Success : Colors.Warning,
		header: `Moderation History — ${username}`,
	});

	container.addTextDisplayComponents(
		new TextDisplayBuilder().setContent(
			`${userMention(targetId)} \`${targetId}\` — **${infractions.length}** infraction(s) total`,
		),
	);

	if (infractions.length === 0) {
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent('No infractions found.'));
		return cv2Reply(container, true);
	}

	container.addSeparatorComponents(separator());

	const PAGE_SIZE = 10;
	const totalPages = Math.ceil(infractions.length / PAGE_SIZE) || 1;
	if (page < 0) page = 0;
	if (page >= totalPages) page = totalPages - 1;

	const slice = infractions.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

	for (const inf of slice) {
		const ts = Math.floor(new Date(inf.createdAt).getTime() / 1000);
		const expiredLabel = (inf as any).isExpired ? ' [EXPIRED]' : '';
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`**Case \`${inf.caseId}\`** — ${titleCaseType(inf.type)}${expiredLabel}\n` +
					`${field('Moderator', `<@${inf.moderatorId}>`)}\n` +
					`${field('Reason', inf.reason)}\n` +
					`-# <t:${ts}:F>`,
			),
		);
		container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
	}

	if (totalPages > 1) {
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Page ${page + 1} of ${totalPages}`));
		container.addActionRowComponents(
			pageNavRow(`page:warnings:${targetId}:${page - 1}`, `page:warnings:${targetId}:${page + 1}`, {
				atStart: page === 0,
				atEnd: page === totalPages - 1,
			}),
		);
	}

	return cv2Reply(container, true);
}

export async function buildMyWarningsPage(guildId: string, targetId: string, username: string, page: number) {
	const infractions = await getInfractions(guildId, targetId);

	const container = makeContainer({
		color: infractions.length === 0 ? Colors.Success : Colors.Warning,
		header: `My Infractions — ${username}`,
	});

	container.addTextDisplayComponents(
		new TextDisplayBuilder().setContent(
			`${userMention(targetId)} \`${targetId}\` — **${infractions.length}** infraction(s) total`,
		),
	);

	const appealRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder().setCustomId('ticket:appeal').setLabel('Appeal').setStyle(ButtonStyle.Primary),
	);

	if (infractions.length === 0) {
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent('You have a clean record.'));
		container.addActionRowComponents(appealRow);
		return cv2Reply(container, true);
	}

	container.addSeparatorComponents(separator());

	const PAGE_SIZE = 5;
	const totalPages = Math.ceil(infractions.length / PAGE_SIZE) || 1;
	if (page < 0) page = 0;
	if (page >= totalPages) page = totalPages - 1;

	const slice = infractions.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

	for (const inf of slice) {
		const ts = Math.floor(new Date(inf.createdAt).getTime() / 1000);
		const expiredLabel = (inf as any).isExpired ? ' [EXPIRED]' : '';
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`**Case \`${inf.caseId}\`** — ${titleCaseType(inf.type)}${expiredLabel}\n` +
					`${field('Reason', inf.reason)}\n` +
					`-# <t:${ts}:F>`,
			),
		);
		container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
	}

	container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Page ${page + 1} of ${totalPages}`));

	if (totalPages > 1) {
		container.addActionRowComponents(
			pageNavRow(`page:mywarnings:${targetId}:${page - 1}`, `page:mywarnings:${targetId}:${page + 1}`, {
				atStart: page === 0,
				atEnd: page === totalPages - 1,
			}),
		);
	}

	container.addActionRowComponents(appealRow);

	return cv2Reply(container, true);
}

export async function buildNotesPage(guildId: string, targetId: string, username: string, page: number) {
	const { getNotes } = await import('../lib/ModerationUtil.js');
	const notes = await getNotes(guildId, targetId);

	const container = makeContainer({
		color: notes.length === 0 ? Colors.Neutral : Colors.Info,
		header: `Notes — ${username}`,
	});

	if (notes.length === 0) {
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent('No notes found for this user.'));
		return cv2Reply(container, true);
	}

	container.addSeparatorComponents(separator());

	const PAGE_SIZE = 5;
	const totalPages = Math.ceil(notes.length / PAGE_SIZE) || 1;
	if (page < 0) page = 0;
	if (page >= totalPages) page = totalPages - 1;

	const slice = notes.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

	for (const note of slice) {
		const ts = Math.floor(new Date(note.createdAt).getTime() / 1000);
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(`**#${note.id}** — <@${note.moderatorId}> • <t:${ts}:R>\n${note.content}`),
		);
		container.addSeparatorComponents(separator());
	}

	container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Page ${page + 1} of ${totalPages}`));

	if (totalPages > 1) {
		container.addActionRowComponents(
			pageNavRow(`page:notes:${targetId}:${page - 1}`, `page:notes:${targetId}:${page + 1}`, {
				atStart: page === 0,
				atEnd: page === totalPages - 1,
			}),
		);
	}

	return cv2Reply(container, true);
}

export async function buildCasesPage(
	guildId: string,
	page: number,
	filterType?: string | null,
	filterUserId?: string | null,
	filterModId?: string | null,
) {
	const { db, schema } = await import('../lib/database.js');
	const { and, eq, desc, count } = await import('drizzle-orm');

	const conditions = [eq(schema.infractions.guildId, guildId)];
	if (filterType && filterType !== 'all') {
		conditions.push(eq(schema.infractions.type, filterType as any));
	}
	if (filterUserId && filterUserId !== 'all') {
		conditions.push(eq(schema.infractions.userId, filterUserId));
	}
	if (filterModId && filterModId !== 'all') {
		conditions.push(eq(schema.infractions.moderatorId, filterModId));
	}

	const totalResult = await db
		.select({ n: count() })
		.from(schema.infractions)
		.where(and(...conditions));
	const totalCount = totalResult[0]?.n ?? 0;

	const PAGE_SIZE = 10;
	const totalPages = Math.ceil(totalCount / PAGE_SIZE) || 1;
	if (page < 0) page = 0;
	if (page >= totalPages) page = totalPages - 1;

	const rows = await db
		.select()
		.from(schema.infractions)
		.where(and(...conditions))
		.orderBy(desc(schema.infractions.createdAt))
		.limit(PAGE_SIZE)
		.offset(page * PAGE_SIZE);

	const container = makeContainer({
		color: Colors.Info,
		header: `Rolling Cases (${totalCount})`,
	});

	if (rows.length === 0) {
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent('No cases match the filters.'));
		return cv2Reply(container, true);
	}

	container.addSeparatorComponents(separator());

	for (const inf of rows) {
		const ts = Math.floor(new Date(inf.createdAt).getTime() / 1000);
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`**Case \`${inf.caseId}\`** — ${titleCaseType(inf.type)}\n` +
					`${field('User', `<@${inf.userId}>`)}\n` +
					`${field('Moderator', `<@${inf.moderatorId}>`)}\n` +
					`${field('Reason', inf.reason)}\n` +
					`-# <t:${ts}:F>`,
			),
		);
		container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
	}

	container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Page ${page + 1} of ${totalPages}`));

	if (totalPages > 1) {
		const typeVal = filterType || 'all';
		const userVal = filterUserId || 'all';
		const modVal = filterModId || 'all';

		container.addActionRowComponents(
			pageNavRow(
				`page:cases:${page - 1}:${typeVal}:${userVal}:${modVal}`,
				`page:cases:${page + 1}:${typeVal}:${userVal}:${modVal}`,
				{ atStart: page === 0, atEnd: page === totalPages - 1 },
			),
		);
	}

	return cv2Reply(container, true);
}

@ApplyOptions<Listener.Options>({ name: 'paginationInteractions', event: Events.InteractionCreate })
export class PaginationInteractions extends Listener {
	public override async run(interaction: Interaction) {
		if (!interaction.isButton() || !interaction.customId.startsWith('page:')) return;
		if (!interaction.inCachedGuild()) return;
		if (await isBotBlacklisted(interaction.user.id)) return;

		const parts = interaction.customId.split(':');
		const type = parts[1];

		const modTypes = ['warnings', 'notes', 'timeouts', 'cases'];
		if (modTypes.includes(type)) {
			const { PermissionFlagsBits } = await import('discord.js');
			if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
				const { errorReply } = await import('../lib/components.js');
				// biome-ignore lint/suspicious/noExplicitAny: CV2 flag type gap
				await interaction.reply({ ...errorReply('You do not have permission to view this.'), flags: 64 } as any);
				return;
			}
		}

		await interaction.deferUpdate();

		if (type === 'warnings') {
			const targetId = parts[2];
			const page = parseInt(parts[3], 10) || 0;

			const user = await interaction.client.users.fetch(targetId).catch(() => null);
			const username = user?.username ?? 'User';

			const payload = await buildWarningsPage(interaction.guildId, targetId, username, page);
			await interaction.editReply(payload);
		} else if (type === 'mywarnings') {
			const targetId = parts[2];
			const page = parseInt(parts[3], 10) || 0;

			if (interaction.user.id !== targetId) return;

			const payload = await buildMyWarningsPage(interaction.guildId, targetId, interaction.user.username, page);
			await interaction.editReply(payload);
		} else if (type === 'notes') {
			const targetId = parts[2];
			const page = parseInt(parts[3], 10) || 0;

			const user = await interaction.client.users.fetch(targetId).catch(() => null);
			const username = user?.username ?? 'User';

			const payload = await buildNotesPage(interaction.guildId, targetId, username, page);
			await interaction.editReply(payload);
		} else if (type === 'timeouts') {
			const searchVal = parts[2];
			const page = parseInt(parts[3], 10) || 0;
			const searchUserId = searchVal === 'all' ? null : searchVal;

			const payload = await buildActiveTimeoutsPage(interaction.guild, page, searchUserId);
			await interaction.editReply(payload);
		} else if (type === 'cases') {
			const page = parseInt(parts[2], 10) || 0;
			const typeFilter = parts[3];
			const userFilter = parts[4];
			const modFilter = parts[5];

			const payload = await buildCasesPage(interaction.guildId, page, typeFilter, userFilter, modFilter);
			await interaction.editReply(payload);
		} else if (type === 'leaderboard') {
			const limit = parseInt(parts[2], 10) || 10;
			const page = parseInt(parts[3], 10) || 0;

			// Need to dynamically import buildLeaderboardPage so we don't cause circular dependencies
			const { buildLeaderboardPage } = await import('../lib/LeaderboardUtil.js');

			// Guild name might not be strictly necessary if it's passed as default or fetched
			const guild = interaction.client.guilds.cache.get(interaction.guildId);
			const payload = await buildLeaderboardPage(
				interaction.guildId,
				guild?.name ?? 'Server',
				limit,
				page,
				interaction.client,
			);

			if (payload.content && !payload.files?.length) {
				await interaction.editReply(payload);
				return;
			}

			// Edit reply requires files to be passed, but interaction.editReply will remove old attachments automatically
			await interaction.editReply(payload);
		} else if (type === 'tags') {
			const page = parseInt(parts[3], 10) || 0;
			const payload = await buildTagsPage(interaction.guildId, page);

			if (payload.content) {
				await interaction.editReply(payload);
				return;
			}

			await interaction.editReply(payload);
		}
	}
}
