import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { ChannelType, MessageFlags, PermissionFlagsBits, type TextChannel, TextDisplayBuilder } from 'discord.js';
import { eq } from 'drizzle-orm';
import { Colors, CV2_FLAG, cv2Reply, errorReply, makeContainer, successReply } from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';
import {
	addIncidentUpdate,
	addServiceMaintenanceUpdate,
	buildStatusData,
	buildStatusPanel,
	clearServiceMaintenanceUpdates,
	clearServiceOverride,
	createIncident,
	getActiveIncidents,
	getAllServices,
	type IncidentSeverity,
	type IncidentStatus,
	notifySubscribers,
	type OverrideStatus,
	reloadStatusConfig,
	resolveIncident,
	runAllChecks,
	setServiceOverride,
} from '../../lib/StatusUtil.js';

function hasManagePerms(perms: Readonly<import('discord.js').PermissionsBitField> | null): boolean {
	if (!perms) return false;
	if (perms.has(PermissionFlagsBits.Administrator)) return true;
	return perms.has(PermissionFlagsBits.ManageGuild);
}

@ApplyOptions<Subcommand.Options>({
	name: 'status',
	description: 'Manage or view the system status panel.',
	subcommands: [
		{ name: 'panel', chatInputRun: 'chatInputPanel' },
		{ name: 'refresh', chatInputRun: 'chatInputRefresh' },
		{ name: 'reload', chatInputRun: 'chatInputReload' },
		{ name: 'maintenance', chatInputRun: 'chatInputMaintenance' },
		{ name: 'service', chatInputRun: 'chatInputService' },
		{ name: 'incident', chatInputRun: 'chatInputIncident' },
	],
})
export class StatusCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		const serviceChoices = getAllServices().map((s) => ({ name: s.label, value: s.id }));

		registry.registerChatInputCommand((builder) =>
			builder
				.setName('status')
				.setDescription('Manage or view the system status panel.')
				.addSubcommand((sub) =>
					sub
						.setName('panel')
						.setDescription('Post (or replace) the live status panel in a channel.')
						.addChannelOption((o) =>
							o
								.setName('channel')
								.setDescription('Channel to post the panel in.')
								.addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
								.setRequired(true),
						),
				)
				.addSubcommand((sub) =>
					sub.setName('refresh').setDescription('Force an immediate status check and panel update.'),
				)
				.addSubcommand((sub) => sub.setName('reload').setDescription('Reload status services from config/status.yml.'))
				.addSubcommand((sub) =>
					sub
						.setName('maintenance')
						.setDescription('Set maintenance mode.')
						.addStringOption((o) =>
							o
								.setName('action')
								.setDescription('Maintenance action.')
								.setRequired(true)
								.addChoices(
									{ name: 'On', value: 'on' },
									{ name: 'Off', value: 'off' },
									{ name: 'Update', value: 'update' },
									{ name: 'Clear Updates', value: 'clear-updates' },
								),
						)
						.addStringOption((o) =>
							o
								.setName('service')
								.setDescription('Which service.')
								.setRequired(true)
								.addChoices(...serviceChoices),
						)
						.addStringOption((o) =>
							o
								.setName('details')
								.setDescription('Reason/Message for the maintenance action.')
								.setRequired(false)
								.setMaxLength(300),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('service')
						.setDescription('Manually override a service status.')
						.addStringOption((o) =>
							o
								.setName('action')
								.setDescription('Override action.')
								.setRequired(true)
								.addChoices({ name: 'Set', value: 'set' }, { name: 'Clear', value: 'clear' }),
						)
						.addStringOption((o) =>
							o
								.setName('service')
								.setDescription('Which service.')
								.setRequired(true)
								.addChoices(...serviceChoices),
						)
						.addStringOption((o) =>
							o
								.setName('status')
								.setDescription('Status to set (required for "set").')
								.setRequired(false)
								.addChoices(
									{ name: '🟢 Online', value: 'online' },
									{ name: '🟡 Degraded', value: 'degraded' },
									{ name: '🔴 Offline', value: 'offline' },
									{ name: '🔧 Maintenance', value: 'maintenance' },
								),
						)
						.addStringOption((o) =>
							o
								.setName('reason')
								.setDescription('Optional reason shown on the panel.')
								.setRequired(false)
								.setMaxLength(150),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('incident')
						.setDescription('Manage status incidents.')
						.addStringOption((o) =>
							o
								.setName('action')
								.setDescription('Incident action.')
								.setRequired(true)
								.addChoices(
									{ name: 'Create', value: 'create' },
									{ name: 'Update', value: 'update' },
									{ name: 'Resolve', value: 'resolve' },
									{ name: 'List Active', value: 'list' },
								),
						)
						.addStringOption((o) =>
							o
								.setName('title')
								.setDescription('Incident title (required for create).')
								.setRequired(false)
								.setMaxLength(100),
						)
						.addStringOption((o) =>
							o
								.setName('severity')
								.setDescription('Incident severity (required for create).')
								.setRequired(false)
								.addChoices(
									{ name: '🟡 Minor', value: 'minor' },
									{ name: '🟠 Major', value: 'major' },
									{ name: '🔴 Critical', value: 'critical' },
									{ name: '🔧 Maintenance', value: 'maintenance' },
								),
						)
						.addStringOption((o) =>
							o.setName('message').setDescription('Message / Update details.').setRequired(false).setMaxLength(500),
						)
						.addIntegerOption((o) =>
							o
								.setName('id')
								.setDescription('Incident ID (required for update/resolve).')
								.setRequired(false)
								.setMinValue(1),
						)
						.addStringOption((o) =>
							o
								.setName('status')
								.setDescription('New incident status (required for update).')
								.setRequired(false)
								.addChoices(
									{ name: 'Investigating', value: 'investigating' },
									{ name: 'Identified', value: 'identified' },
									{ name: 'Monitoring', value: 'monitoring' },
								),
						),
				),
		);
	}

	private async refreshPanel(client: Subcommand['container']['client']): Promise<boolean> {
		const [panel] = await db.select().from(schema.statusPanel).where(eq(schema.statusPanel.id, 1));
		if (!panel) return false;

		const guild = client.guilds.cache.get(panel.guildId);
		const channel = guild?.channels.cache.get(panel.channelId);
		if (!channel?.isTextBased()) return false;

		const statusMap = await runAllChecks();
		const categories = await buildStatusData(statusMap);
		const { container: panelContainer, row } = await buildStatusPanel(categories, new Date());

		try {
			const message = await channel.messages.fetch(panel.messageId);
			await message.edit({ components: [panelContainer, row], flags: CV2_FLAG });
		} catch {
			return false;
		}
		return true;
	}

	// ── /status panel ──────────────────────────────────────────────────────────
	public async chatInputPanel(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Guild only.'));

		if (!hasManagePerms(interaction.memberPermissions)) {
			return interaction.editReply(errorReply('You do not have permission to manage the system status.'));
		}

		const channel = interaction.options.getChannel('channel', true) as TextChannel;

		const statusMap = await runAllChecks();
		const categories = await buildStatusData(statusMap);
		const { container, row } = await buildStatusPanel(categories, new Date());

		const message = await channel.send({ components: [container, row], flags: CV2_FLAG });

		await db
			.insert(schema.statusPanel)
			.values({ id: 1, channelId: channel.id, messageId: message.id, guildId: interaction.guildId })
			.onDuplicateKeyUpdate({
				set: { channelId: channel.id, messageId: message.id, guildId: interaction.guildId },
			});

		return interaction.editReply(successReply(`Status panel posted in <#${channel.id}>.`));
	}

	// ── /status refresh ────────────────────────────────────────────────────────
	public async chatInputRefresh(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Guild only.'));

		if (!hasManagePerms(interaction.memberPermissions)) {
			return interaction.editReply(errorReply('You do not have permission to manage the system status.'));
		}

		const ok = await this.refreshPanel(interaction.client);
		if (!ok)
			return interaction.editReply(errorReply('No panel found or could not edit it. Use `/status panel` first.'));
		return interaction.editReply(successReply('Status panel refreshed.'));
	}

	// ── /status reload ─────────────────────────────────────────────────────────
	public async chatInputReload(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Guild only.'));

		if (!hasManagePerms(interaction.memberPermissions)) {
			return interaction.editReply(errorReply('You do not have permission to manage the system status.'));
		}

		try {
			const config = reloadStatusConfig();
			const serviceCount = config.categories.reduce((n, c) => n + c.services.length, 0);
			await this.refreshPanel(interaction.client).catch(() => false);
			return interaction.editReply(
				successReply(
					`Reloaded status.yml — ${config.categories.length} categor${config.categories.length === 1 ? 'y' : 'ies'}, ${serviceCount} service${serviceCount === 1 ? '' : 's'} (checks every ${config.intervalMinutes}m).`,
				),
			);
		} catch (err) {
			return interaction.editReply(errorReply(err instanceof Error ? err.message : 'Failed to reload status.yml'));
		}
	}

	// ── /status maintenance ────────────────────────────────────────────────────
	public async chatInputMaintenance(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Guild only.'));

		if (!hasManagePerms(interaction.memberPermissions)) {
			return interaction.editReply(errorReply('You do not have permission to manage the system status.'));
		}

		const action = interaction.options.getString('action', true);
		const serviceId = interaction.options.getString('service', true);
		const details = interaction.options.getString('details') ?? null;

		if (action === 'on') {
			await setServiceOverride(serviceId, 'maintenance', details, interaction.user.id);
			await this.refreshPanel(interaction.client);
			return interaction.editReply(
				successReply(`**${serviceId}** set to 🔧 Maintenance.${details ? `\nReason: ${details}` : ''}`),
			);
		} else if (action === 'off') {
			await clearServiceOverride(serviceId);
			await this.refreshPanel(interaction.client);
			return interaction.editReply(successReply(`Maintenance ended for **${serviceId}**. Auto-checks resumed.`));
		} else if (action === 'update') {
			if (!details) {
				return interaction.editReply(errorReply('You must specify a message/details for the update.'));
			}
			await addServiceMaintenanceUpdate(serviceId, details);
			await this.refreshPanel(interaction.client);
			return interaction.editReply(successReply(`Maintenance update posted for **${serviceId}**.`));
		} else if (action === 'clear-updates') {
			await clearServiceMaintenanceUpdates(serviceId);
			await this.refreshPanel(interaction.client);
			return interaction.editReply(successReply(`Maintenance updates cleared for **${serviceId}**.`));
		}

		return interaction.editReply(errorReply('Unknown maintenance action.'));
	}

	// ── /status service ────────────────────────────────────────────────────────
	public async chatInputService(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Guild only.'));

		if (!hasManagePerms(interaction.memberPermissions)) {
			return interaction.editReply(errorReply('You do not have permission to manage the system status.'));
		}

		const action = interaction.options.getString('action', true);
		const serviceId = interaction.options.getString('service', true);

		if (action === 'set') {
			const status = interaction.options.getString('status') as OverrideStatus | null;
			if (!status) {
				return interaction.editReply(errorReply('You must specify a status to set.'));
			}
			const reason = interaction.options.getString('reason') ?? null;

			await setServiceOverride(serviceId, status, reason, interaction.user.id);
			await this.refreshPanel(interaction.client);

			const label =
				status === 'online'
					? '🟢 Online'
					: status === 'offline'
						? '🔴 Offline'
						: status === 'degraded'
							? '🟡 Degraded'
							: '🔧 Maintenance';
			return interaction.editReply(
				successReply(`**${serviceId}** manually set to ${label}.${reason ? `\nReason: ${reason}` : ''}`),
			);
		} else if (action === 'clear') {
			await clearServiceOverride(serviceId);
			await this.refreshPanel(interaction.client);
			return interaction.editReply(successReply(`Override cleared for **${serviceId}**. Auto-checks resumed.`));
		}

		return interaction.editReply(errorReply('Unknown service override action.'));
	}

	// ── /status incident ───────────────────────────────────────────────────────
	public async chatInputIncident(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Guild only.'));

		if (!hasManagePerms(interaction.memberPermissions)) {
			return interaction.editReply(errorReply('You do not have permission to manage the system status.'));
		}

		const action = interaction.options.getString('action', true);

		if (action === 'create') {
			const title = interaction.options.getString('title');
			const severity = interaction.options.getString('severity') as IncidentSeverity | null;
			const message = interaction.options.getString('message');

			if (!title || !severity || !message) {
				return interaction.editReply(
					errorReply('You must specify title, severity, and message to create an incident.'),
				);
			}

			const incident = await createIncident(title, severity, [], message, interaction.user.id);
			await this.refreshPanel(interaction.client);
			await notifySubscribers({ title, status: 'investigating', severity, updateMessage: message });

			return interaction.editReply(successReply(`Incident **#${incident.id} — ${title}** created and posted.`));
		} else if (action === 'update') {
			const id = interaction.options.getInteger('id');
			const status = interaction.options.getString('status') as IncidentStatus | null;
			const message = interaction.options.getString('message');

			if (!id || !status || !message) {
				return interaction.editReply(errorReply('You must specify incident id, new status, and update message.'));
			}

			await addIncidentUpdate(id, status, message, interaction.user.id);
			await this.refreshPanel(interaction.client);

			const active = await getActiveIncidents();
			const incident = active.find((i) => i.id === id);
			if (incident) {
				await notifySubscribers({
					title: incident.title,
					status,
					severity: incident.severity as IncidentSeverity,
					updateMessage: message,
				});
			}

			return interaction.editReply(successReply(`Incident **#${id}** updated.`));
		} else if (action === 'resolve') {
			const id = interaction.options.getInteger('id');
			const message = interaction.options.getString('message') ?? 'This incident has been resolved.';

			if (!id) {
				return interaction.editReply(errorReply('You must specify the incident ID to resolve.'));
			}

			const active = await getActiveIncidents();
			const incident = active.find((i) => i.id === id);
			if (!incident) {
				return interaction.editReply(errorReply(`No active incident with ID **#${id}** found.`));
			}

			await resolveIncident(id, message, interaction.user.id);
			await this.refreshPanel(interaction.client);
			await notifySubscribers({
				title: incident.title,
				status: 'resolved',
				severity: incident.severity as IncidentSeverity,
				updateMessage: message,
			});

			return interaction.editReply(successReply(`Incident **#${id} — ${incident.title}** resolved.`));
		} else if (action === 'list') {
			const active = await getActiveIncidents();
			if (active.length === 0) {
				return interaction.editReply(successReply('No active incidents.'));
			}

			const lines = active.map((i) => {
				const sev =
					i.severity === 'critical' ? '🔴' : i.severity === 'major' ? '🟠' : i.severity === 'minor' ? '🟡' : '🔧';
				const ts = Math.floor(new Date(i.startedAt).getTime() / 1000);
				return `**#${i.id}** ${sev} ${i.title} — \`${i.status}\` <t:${ts}:R>`;
			});

			const container = makeContainer({ color: Colors.Warning, header: 'Active Incidents' });
			container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
			return interaction.editReply(cv2Reply(container, true));
		}

		return interaction.editReply(errorReply('Unknown incident action.'));
	}
}
