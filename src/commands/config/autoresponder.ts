import { ApplyOptions } from '@sapphire/decorators';
import type { Command } from '@sapphire/framework';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { ChannelType, MessageFlags, PermissionFlagsBits, TextDisplayBuilder } from 'discord.js';
import { and, eq } from 'drizzle-orm';
import type { AutoresponderMatchMode } from '../../db/schema.js';
import { matchModeLabel, parseChannelIds, validateRegexTrigger } from '../../lib/AutoresponderUtil.js';
import { Colors, cv2Reply, errorReply, makeContainer, separator, successReply } from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';

const MATCH_CHOICES = [
	{ name: 'Contains', value: 'contains' },
	{ name: 'Exact match', value: 'exact' },
	{ name: 'Starts with', value: 'starts_with' },
	{ name: 'Ends with', value: 'ends_with' },
	{ name: 'Regex', value: 'regex' },
] as const;

@ApplyOptions<Subcommand.Options>({
	name: 'autoresponder',
	description: 'Manage automatic keyword replies.',
	preconditions: ['Moderation'],
	subcommands: [
		{ name: 'add', chatInputRun: 'chatInputAdd' },
		{ name: 'remove', chatInputRun: 'chatInputRemove' },
		{ name: 'list', chatInputRun: 'chatInputList' },
		{ name: 'toggle', chatInputRun: 'chatInputToggle' },
		{ name: 'edit', chatInputRun: 'chatInputEdit' },
	],
})
export class AutoresponderCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('autoresponder')
				.setDescription('Manage automatic keyword replies.')
				.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
				.addSubcommand((sub) =>
					sub
						.setName('add')
						.setDescription('Create an autoresponder rule.')
						.addStringOption((o) =>
							o.setName('name').setDescription('Short name for this rule.').setRequired(true).setMaxLength(32),
						)
						.addStringOption((o) =>
							o.setName('trigger').setDescription('Text or pattern to match.').setRequired(true).setMaxLength(200),
						)
						.addStringOption((o) =>
							o
								.setName('response')
								.setDescription('Reply text. Placeholders: {user} {mention} {server} {channel}')
								.setRequired(true)
								.setMaxLength(2000),
						)
						.addStringOption((o) =>
							o
								.setName('match')
								.setDescription('How to match the trigger (default: contains).')
								.setRequired(false)
								.addChoices(...MATCH_CHOICES),
						)
						.addIntegerOption((o) =>
							o
								.setName('cooldown')
								.setDescription('Seconds before this rule can fire again per user (default 10).')
								.setRequired(false)
								.setMinValue(0)
								.setMaxValue(3600),
						)
						.addChannelOption((o) =>
							o
								.setName('channel')
								.setDescription('Limit to this channel (omit = all channels).')
								.addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
								.setRequired(false),
						)
						.addBooleanOption((o) =>
							o.setName('reply').setDescription('Reply to the triggering message (default true).').setRequired(false),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('remove')
						.setDescription('Delete an autoresponder rule.')
						.addStringOption((o) =>
							o.setName('name').setDescription('Rule name.').setRequired(true).setAutocomplete(true),
						),
				)
				.addSubcommand((sub) => sub.setName('list').setDescription('List autoresponder rules for this server.'))
				.addSubcommand((sub) =>
					sub
						.setName('toggle')
						.setDescription('Enable or disable a rule.')
						.addStringOption((o) =>
							o.setName('name').setDescription('Rule name.').setRequired(true).setAutocomplete(true),
						)
						.addBooleanOption((o) => o.setName('enabled').setDescription('Enabled?').setRequired(true)),
				)
				.addSubcommand((sub) =>
					sub
						.setName('edit')
						.setDescription('Edit an autoresponder rule.')
						.addStringOption((o) =>
							o.setName('name').setDescription('Rule name.').setRequired(true).setAutocomplete(true),
						)
						.addStringOption((o) =>
							o.setName('trigger').setDescription('New trigger text/pattern.').setRequired(false).setMaxLength(200),
						)
						.addStringOption((o) =>
							o.setName('response').setDescription('New response text.').setRequired(false).setMaxLength(2000),
						)
						.addStringOption((o) =>
							o
								.setName('match')
								.setDescription('New match mode.')
								.setRequired(false)
								.addChoices(...MATCH_CHOICES),
						)
						.addIntegerOption((o) =>
							o
								.setName('cooldown')
								.setDescription('New cooldown in seconds.')
								.setRequired(false)
								.setMinValue(0)
								.setMaxValue(3600),
						)
						.addBooleanOption((o) =>
							o.setName('reply').setDescription('Reply to the triggering message?').setRequired(false),
						),
				),
		);
	}

	public override async autocompleteRun(interaction: Command.AutocompleteInteraction) {
		if (!interaction.inCachedGuild()) return interaction.respond([]);
		const focused = interaction.options.getFocused().toLowerCase();
		const rows = await db
			.select({ name: schema.autoresponders.name })
			.from(schema.autoresponders)
			.where(eq(schema.autoresponders.guildId, interaction.guildId));

		return interaction.respond(
			rows
				.filter((r) => !focused || r.name.toLowerCase().includes(focused))
				.slice(0, 25)
				.map((r) => ({ name: r.name, value: r.name })),
		);
	}

	public async chatInputAdd(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const name = interaction.options.getString('name', true).trim().toLowerCase();
		const trigger = interaction.options.getString('trigger', true);
		const response = interaction.options.getString('response', true);
		const matchMode = (interaction.options.getString('match') ?? 'contains') as AutoresponderMatchMode;
		const cooldown = interaction.options.getInteger('cooldown') ?? 10;
		const replyToMessage = interaction.options.getBoolean('reply') ?? true;
		const channel = interaction.options.getChannel('channel');

		if (!/^[a-z0-9_-]{1,32}$/.test(name)) {
			return interaction.editReply(errorReply('Name must be 1–32 chars: letters, numbers, `_` or `-`.'));
		}

		if (matchMode === 'regex') {
			const err = validateRegexTrigger(trigger);
			if (err) return interaction.editReply(errorReply(err));
		}

		const existing = await db
			.select()
			.from(schema.autoresponders)
			.where(and(eq(schema.autoresponders.guildId, interaction.guildId), eq(schema.autoresponders.name, name)))
			.limit(1)
			.then((rows) => rows[0]);
		if (existing) {
			return interaction.editReply(errorReply(`A rule named **${name}** already exists.`));
		}

		const channelIds = channel ? JSON.stringify([channel.id]) : '[]';

		await db.insert(schema.autoresponders).values({
			guildId: interaction.guildId,
			name,
			trigger,
			matchMode,
			response,
			cooldownSeconds: cooldown,
			channelIds,
			replyToMessage,
			createdBy: interaction.user.id,
		});

		return interaction.editReply(
			successReply(
				`Autoresponder **${name}** created — ${matchModeLabel(matchMode)} \`${trigger.slice(0, 40)}\`${channel ? ` in <#${channel.id}>` : ''}.`,
			),
		);
	}

	public async chatInputRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const name = interaction.options.getString('name', true).trim().toLowerCase();
		const result = await db
			.delete(schema.autoresponders)
			.where(and(eq(schema.autoresponders.guildId, interaction.guildId), eq(schema.autoresponders.name, name)));
		const affected = Number((result as any)[0]?.affectedRows ?? 0);

		if (affected === 0) return interaction.editReply(errorReply(`No rule named **${name}**.`));
		return interaction.editReply(successReply(`Deleted autoresponder **${name}**.`));
	}

	public async chatInputList(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const rows = await db
			.select()
			.from(schema.autoresponders)
			.where(eq(schema.autoresponders.guildId, interaction.guildId));

		if (!rows.length) {
			return interaction.editReply(successReply('No autoresponders configured. Use `/autoresponder add`.'));
		}

		const c = makeContainer({ color: Colors.Info, header: `Autoresponders (${rows.length})` });
		c.addSeparatorComponents(separator());
		const lines = rows.map((r) => {
			const channels = parseChannelIds(r.channelIds);
			const scope = channels.length ? channels.map((id) => `<#${id}>`).join(' ') : 'all channels';
			return (
				`${r.enabled ? '🟢' : '🔴'} **${r.name}** — ${matchModeLabel(r.matchMode)} \`${r.trigger.slice(0, 40)}\`\n` +
				`-# ${scope} · cooldown ${r.cooldownSeconds}s`
			);
		});
		c.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n\n').slice(0, 3800)));
		return interaction.editReply(cv2Reply(c, true));
	}

	public async chatInputToggle(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const name = interaction.options.getString('name', true).trim().toLowerCase();
		const enabled = interaction.options.getBoolean('enabled', true);

		const result = await db
			.update(schema.autoresponders)
			.set({ enabled })
			.where(and(eq(schema.autoresponders.guildId, interaction.guildId), eq(schema.autoresponders.name, name)));
		const affected = Number((result as any)[0]?.affectedRows ?? 0);

		if (affected === 0) return interaction.editReply(errorReply(`No rule named **${name}**.`));
		return interaction.editReply(successReply(`Autoresponder **${name}** ${enabled ? 'enabled' : 'disabled'}.`));
	}

	public async chatInputEdit(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const name = interaction.options.getString('name', true).trim().toLowerCase();
		const trigger = interaction.options.getString('trigger');
		const response = interaction.options.getString('response');
		const matchMode = interaction.options.getString('match') as AutoresponderMatchMode | null;
		const cooldown = interaction.options.getInteger('cooldown');
		const replyToMessage = interaction.options.getBoolean('reply');

		if (trigger === null && response === null && matchMode === null && cooldown === null && replyToMessage === null) {
			return interaction.editReply(errorReply('Provide at least one field to change.'));
		}

		const existing = await db
			.select()
			.from(schema.autoresponders)
			.where(and(eq(schema.autoresponders.guildId, interaction.guildId), eq(schema.autoresponders.name, name)))
			.limit(1)
			.then((rows) => rows[0]);
		if (!existing) return interaction.editReply(errorReply(`No rule named **${name}**.`));

		const nextMode = matchMode ?? existing.matchMode;
		const nextTrigger = trigger ?? existing.trigger;
		if (nextMode === 'regex') {
			const err = validateRegexTrigger(nextTrigger);
			if (err) return interaction.editReply(errorReply(err));
		}

		await db
			.update(schema.autoresponders)
			.set({
				...(trigger !== null ? { trigger } : {}),
				...(response !== null ? { response } : {}),
				...(matchMode !== null ? { matchMode } : {}),
				...(cooldown !== null ? { cooldownSeconds: cooldown } : {}),
				...(replyToMessage !== null ? { replyToMessage } : {}),
			})
			.where(eq(schema.autoresponders.id, existing.id));

		return interaction.editReply(successReply(`Updated autoresponder **${name}**.`));
	}
}
