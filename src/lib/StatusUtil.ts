import { existsSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { container } from '@sapphire/framework';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, TextDisplayBuilder } from 'discord.js';
import { and, desc, eq, gte, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import {
	type IncidentSeverity,
	type IncidentStatus,
	type IncidentUpdate,
	incidents,
	maintenanceState,
	type OverrideStatus,
	serviceOverrides,
	statusChecks,
	statusSubscribers,
} from '../db/schema.js';
import { Colors, CV2_FLAG, makeContainer, separator } from './components.js';
import { db } from './database.js';

// ─── Config schema ─────────────────────────────────────────────────────────────

const HttpServiceSchema = z.object({
	id: z.string(),
	label: z.string(),
	type: z.literal('http'),
	url: z.string().url(),
});

const TcpServiceSchema = z.object({
	id: z.string(),
	label: z.string(),
	type: z.literal('tcp'),
	host: z.string(),
	port: z.number().int().min(1).max(65535),
});

const ServiceSchema = z.discriminatedUnion('type', [HttpServiceSchema, TcpServiceSchema]);

const CategorySchema = z.object({
	id: z.string(),
	label: z.string(),
	services: z.array(ServiceSchema),
});

const StatusAlertsSchema = z.object({
	enabled: z.boolean().default(true),
	channelId: z
		.string()
		.regex(/^\d{17,20}$/)
		.optional(),
	roleId: z
		.string()
		.regex(/^\d{17,20}$/)
		.optional(),
	notifyRecovery: z.boolean().default(true),
	pingOnRecovery: z.boolean().default(false),
});

const StatusConfigSchema = z.object({
	intervalMinutes: z.number().int().min(1).default(5),
	alerts: StatusAlertsSchema.default({
		enabled: true,
		notifyRecovery: true,
		pingOnRecovery: false,
	}),
	categories: z.array(CategorySchema),
});

export type ServiceConfig = z.infer<typeof ServiceSchema>;
export type CategoryConfig = z.infer<typeof CategorySchema>;
export type StatusConfig = z.infer<typeof StatusConfigSchema>;

// ─── Load config ───────────────────────────────────────────────────────────────

const DEFAULT_STATUS_PATH = join(process.cwd(), 'config', 'status.yml');

let _config: StatusConfig | null = null;

/** Load (or return cached) status.yml. Throws on missing/invalid config. */
export function loadStatusConfig(filePath: string = DEFAULT_STATUS_PATH): StatusConfig {
	if (!existsSync(filePath)) {
		throw new Error(
			`Status config not found at ${filePath}. Copy config/status.example.yml to config/status.yml and fill in services.`,
		);
	}
	const text = readFileSync(filePath, 'utf-8');
	let yamlData: unknown;
	try {
		yamlData = parseYaml(text);
	} catch (err) {
		throw new Error(`Failed to parse status.yml: ${err instanceof Error ? err.message : String(err)}`);
	}
	_config = StatusConfigSchema.parse(yamlData);
	return _config;
}

/** Re-read status.yml and swap the cache. */
export function reloadStatusConfig(filePath: string = DEFAULT_STATUS_PATH): StatusConfig {
	_config = null;
	return loadStatusConfig(filePath);
}

export function getStatusConfig(): StatusConfig {
	if (_config) return _config;
	return loadStatusConfig();
}

export function getAllServices(): ServiceConfig[] {
	return getStatusConfig().categories.flatMap((c) => c.services);
}

// ─── Service checks ────────────────────────────────────────────────────────────

const HTTP_TIMEOUT_MS = 5_000;
const TCP_TIMEOUT_MS = 5_000;

async function checkHttp(url: string): Promise<{ online: boolean; pingMs: number }> {
	const start = Date.now();
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
		const res = await fetch(url, { method: 'GET', signal: controller.signal });
		clearTimeout(timer);
		return { online: res.status < 500, pingMs: Date.now() - start };
	} catch {
		return { online: false, pingMs: Date.now() - start };
	}
}

function checkTcp(host: string, port: number): Promise<{ online: boolean; pingMs: number }> {
	return new Promise((resolve) => {
		const start = Date.now();
		const socket = createConnection({ host, port });
		const timer = setTimeout(() => {
			socket.destroy();
			resolve({ online: false, pingMs: Date.now() - start });
		}, TCP_TIMEOUT_MS);

		socket.once('connect', () => {
			clearTimeout(timer);
			const pingMs = Date.now() - start;
			socket.destroy();
			resolve({ online: true, pingMs });
		});

		socket.once('error', () => {
			clearTimeout(timer);
			const pingMs = Date.now() - start;
			socket.destroy();
			resolve({ online: false, pingMs });
		});
	});
}

export async function checkService(service: ServiceConfig): Promise<{ online: boolean; pingMs: number }> {
	if (service.type === 'http') return checkHttp(service.url);
	return checkTcp(service.host, service.port);
}

export type StatusCheckResult = {
	online: boolean;
	pingMs: number;
	previousOnline: boolean | null;
};

let activeStatusCheck: Promise<Map<string, StatusCheckResult>> | null = null;

async function sendStatusTransitionAlerts(results: Map<string, StatusCheckResult>): Promise<void> {
	const config = getStatusConfig();
	if (!config.alerts.enabled) return;

	const channelId = config.alerts.channelId ?? process.env.STATUS_ALERT_CHANNEL_ID?.trim();
	const roleId = config.alerts.roleId ?? process.env.STATUS_ALERT_ROLE_ID?.trim();
	if (!channelId) return;

	const transitions = [...results].filter(
		([, result]) =>
			(!result.online && result.previousOnline === true) ||
			(result.online && result.previousOnline === false && config.alerts.notifyRecovery),
	);
	if (transitions.length === 0) return;

	const channel = await container.client.channels.fetch(channelId).catch(() => null);
	if (!channel?.isSendable()) {
		container.logger.warn(`[status] Alert channel ${channelId} was not found or is not sendable.`);
		return;
	}

	const services = new Map(
		config.categories.flatMap((category) => category.services.map((service) => [service.id, service])),
	);

	for (const [serviceId, result] of transitions) {
		const wentOffline = !result.online;
		const service = services.get(serviceId);
		const label = service?.label ?? serviceId;
		const endpoint =
			service?.type === 'http' ? service.url : service?.type === 'tcp' ? `${service.host}:${service.port}` : null;
		const shouldPing = Boolean(roleId && (wentOffline || config.alerts.pingOnRecovery));

		const embed = new EmbedBuilder()
			.setColor(wentOffline ? Colors.Error : Colors.Success)
			.setTitle(wentOffline ? `Service Offline — ${label}` : `Service Restored — ${label}`)
			.setDescription(
				wentOffline
					? `Erica could not reach **${label}** during the latest status check.`
					: `**${label}** is responding again after an outage.`,
			)
			.addFields(
				{ name: 'Service', value: `\`${serviceId}\``, inline: true },
				{
					name: wentOffline ? 'Check duration' : 'Response time',
					value: `${result.pingMs}ms`,
					inline: true,
				},
			)
			.setTimestamp();

		if (endpoint) embed.addFields({ name: 'Endpoint', value: `\`${endpoint}\`` });

		await channel
			.send({
				content: shouldPing ? `<@&${roleId}>` : undefined,
				embeds: [embed],
				allowedMentions: { roles: shouldPing && roleId ? [roleId] : [] },
			})
			.catch((err) => container.logger.warn(`[status] Failed to send alert for ${serviceId}:`, err));
	}
}

async function executeAllChecks(): Promise<Map<string, StatusCheckResult>> {
	const services = getAllServices();
	const previousStatuses = new Map(
		await Promise.all(
			services.map(async (service) => [service.id, (await getLatestStatus(service.id)).online] as const),
		),
	);
	const results = await Promise.all(services.map(async (s) => ({ id: s.id, ...(await checkService(s)) })));

	const now = new Date();
	await db
		.insert(statusChecks)
		.values(results.map((r) => ({ serviceId: r.id, online: r.online, pingMs: r.pingMs, checkedAt: now })));

	// Prune checks older than 35 days to keep the table lean
	const cutoff = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
	await db.delete(statusChecks).where(lt(statusChecks.checkedAt, cutoff));

	const statusMap = new Map(
		results.map((r) => [
			r.id,
			{ online: r.online, pingMs: r.pingMs, previousOnline: previousStatuses.get(r.id) ?? null },
		]),
	);
	await sendStatusTransitionAlerts(statusMap);
	return statusMap;
}

/** Run one serialized check pass; concurrent refreshes share its result and cannot consume or duplicate transitions. */
export function runAllChecks(): Promise<Map<string, StatusCheckResult>> {
	if (activeStatusCheck) return activeStatusCheck;
	const check = executeAllChecks().finally(() => {
		if (activeStatusCheck === check) activeStatusCheck = null;
	});
	activeStatusCheck = check;
	return check;
}

// ─── Uptime calculation ────────────────────────────────────────────────────────

/** Rolling 30-day uptime percentage for a service. Returns null if no data yet. */
export async function getUptime(serviceId: string, days = 30): Promise<number | null> {
	const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
	const rows = await db
		.select()
		.from(statusChecks)
		.where(and(eq(statusChecks.serviceId, serviceId), gte(statusChecks.checkedAt, since)));

	if (rows.length === 0) return null;
	const onlineCount = rows.filter((r) => r.online).length;
	return Math.round((onlineCount / rows.length) * 10_000) / 100; // 2 decimal places
}

/**
 * Daily uptime history for a service.
 * Returns one entry per calendar day (UTC) for the last `days` days,
 * with `uptime` as a percentage (0–100) or `null` if no checks that day.
 */
export async function getHistory(
	serviceId: string,
	days = 30,
): Promise<Array<{ date: string; uptime: number | null; avgPingMs: number | null }>> {
	const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
	const rows = await db
		.select()
		.from(statusChecks)
		.where(and(eq(statusChecks.serviceId, serviceId), gte(statusChecks.checkedAt, since)))
		.orderBy(statusChecks.checkedAt);

	// Bucket by UTC date string
	const byDay = new Map<string, { total: number; online: number; pingSum: number; pingCount: number }>();
	for (const row of rows) {
		const date = row.checkedAt.toISOString().slice(0, 10);
		const bucket = byDay.get(date) ?? { total: 0, online: 0, pingSum: 0, pingCount: 0 };
		bucket.total++;
		if (row.online) bucket.online++;
		if (row.pingMs !== null) {
			bucket.pingSum += row.pingMs;
			bucket.pingCount++;
		}
		byDay.set(date, bucket);
	}

	// Fill every day in range (oldest → newest), null where no data
	const result: Array<{ date: string; uptime: number | null; avgPingMs: number | null }> = [];
	for (let d = days - 1; d >= 0; d--) {
		const date = new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
		const bucket = byDay.get(date);
		result.push({
			date,
			uptime: bucket ? Math.round((bucket.online / bucket.total) * 10_000) / 100 : null,
			avgPingMs: bucket && bucket.pingCount > 0 ? Math.round(bucket.pingSum / bucket.pingCount) : null,
		});
	}

	return result;
}

/** Get the most recent check result for a service. */
export async function getLatestStatus(serviceId: string): Promise<{ online: boolean | null; pingMs: number | null }> {
	const [row] = await db
		.select()
		.from(statusChecks)
		.where(eq(statusChecks.serviceId, serviceId))
		.orderBy(desc(statusChecks.checkedAt))
		.limit(1);
	return { online: row?.online ?? null, pingMs: row?.pingMs ?? null };
}

// ─── Maintenance helpers ───────────────────────────────────────────────────────

export type MaintenanceUpdate = { message: string; at: string };

export async function getMaintenance(): Promise<typeof maintenanceState.$inferSelect | null> {
	const [row] = await db.select().from(maintenanceState).where(eq(maintenanceState.id, 1));
	return row ?? null;
}

export async function setMaintenance(patch: Partial<Omit<typeof maintenanceState.$inferInsert, 'id'>>): Promise<void> {
	await db
		.insert(maintenanceState)
		.values({ id: 1, ...patch })
		.onDuplicateKeyUpdate({ set: patch });

	if (patch.enabled !== undefined) {
		await notifySubscribers({
			title: 'Global Maintenance',
			status: patch.enabled ? 'Started' : 'Resolved',
			severity: 'maintenance',
			updateMessage: patch.enabled
				? 'The network is now under global maintenance.'
				: 'Global maintenance has concluded.',
		});
	}
}

export async function addMaintenanceUpdate(message: string): Promise<void> {
	const current = await getMaintenance();
	const updates: MaintenanceUpdate[] = current?.updates ? (JSON.parse(current.updates) as MaintenanceUpdate[]) : [];
	updates.unshift({ message, at: new Date().toISOString() }); // newest first
	if (updates.length > 10) updates.pop(); // keep last 10
	await setMaintenance({ updates: JSON.stringify(updates) });

	await notifySubscribers({
		title: 'Global Maintenance Update',
		status: 'maintenance',
		severity: 'maintenance',
		updateMessage: message,
	});
}

export async function clearMaintenanceUpdates(): Promise<void> {
	await setMaintenance({ updates: '[]' });
}

// ─── Service override helpers ──────────────────────────────────────────────────

export type { IncidentSeverity, IncidentStatus, IncidentUpdate, OverrideStatus };

export async function getServiceOverrides(): Promise<
	Map<string, { status: OverrideStatus; reason: string | null; updates: MaintenanceUpdate[] }>
> {
	const rows = await db.select().from(serviceOverrides);
	return new Map(
		rows.map((r) => [
			r.serviceId,
			{
				status: r.status as OverrideStatus,
				reason: r.reason,
				updates: r.updates ? (JSON.parse(r.updates) as MaintenanceUpdate[]) : [],
			},
		]),
	);
}

export async function setServiceOverride(
	serviceId: string,
	status: OverrideStatus,
	reason: string | null,
	setById: string,
): Promise<void> {
	// Preserve existing updates only when staying in maintenance; clear them on status change
	const [existing] = await db.select().from(serviceOverrides).where(eq(serviceOverrides.serviceId, serviceId));
	const keepUpdates = existing?.status === 'maintenance' && status === 'maintenance' ? existing.updates : '[]';

	await db
		.insert(serviceOverrides)
		.values({ serviceId, status, reason, updates: keepUpdates, setById })
		.onDuplicateKeyUpdate({
			set: { status, reason, updates: keepUpdates, setById, setAt: new Date() },
		});

	await notifySubscribers({
		title: `Service Status Change: ${serviceId}`,
		status: status,
		severity: status === 'offline' ? 'major' : 'maintenance',
		updateMessage: reason ?? `Status changed to ${status}.`,
	});
}

export async function clearServiceOverride(serviceId: string): Promise<void> {
	await db.delete(serviceOverrides).where(eq(serviceOverrides.serviceId, serviceId));

	await notifySubscribers({
		title: `Service Status Restored: ${serviceId}`,
		status: 'resolved',
		severity: 'maintenance',
		updateMessage: `The manual override for **${serviceId}** has been removed. The service has returned to automatic monitoring.`,
	});
}

export async function addServiceMaintenanceUpdate(serviceId: string, message: string): Promise<void> {
	const [row] = await db.select().from(serviceOverrides).where(eq(serviceOverrides.serviceId, serviceId));
	if (!row || row.status !== 'maintenance') return;
	const updates: MaintenanceUpdate[] = row.updates ? (JSON.parse(row.updates) as MaintenanceUpdate[]) : [];
	updates.unshift({ message, at: new Date().toISOString() });
	if (updates.length > 10) updates.pop();
	await db
		.update(serviceOverrides)
		.set({ updates: JSON.stringify(updates) })
		.where(eq(serviceOverrides.serviceId, serviceId));

	await notifySubscribers({
		title: `Maintenance Update: ${serviceId}`,
		status: 'maintenance',
		severity: 'maintenance',
		updateMessage: message,
	});
}

export async function clearServiceMaintenanceUpdates(serviceId: string): Promise<void> {
	await db.update(serviceOverrides).set({ updates: '[]' }).where(eq(serviceOverrides.serviceId, serviceId));
}

// ─── Incident helpers ──────────────────────────────────────────────────────────

export async function getActiveIncidents(): Promise<(typeof incidents.$inferSelect)[]> {
	return db.select().from(incidents).where(isNull(incidents.resolvedAt)).orderBy(desc(incidents.startedAt));
}

export async function getRecentResolvedIncidents(limit = 5): Promise<(typeof incidents.$inferSelect)[]> {
	const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
	return db
		.select()
		.from(incidents)
		.where(and(isNotNull(incidents.resolvedAt), gte(incidents.startedAt, cutoff)))
		.orderBy(desc(incidents.resolvedAt))
		.limit(limit);
}

export async function createIncident(
	title: string,
	severity: IncidentSeverity,
	affectedServiceIds: string[],
	initialMessage: string,
	createdById: string,
): Promise<typeof incidents.$inferSelect> {
	const update: IncidentUpdate = {
		status: 'investigating',
		message: initialMessage,
		at: new Date().toISOString(),
		by: createdById,
	};
	const [idRow] = await db
		.insert(incidents)
		.values({
			title,
			severity,
			status: 'investigating',
			affectedServiceIds: JSON.stringify(affectedServiceIds),
			updates: JSON.stringify([update]),
			createdById,
		})
		.$returningId();
	const [row] = await db.select().from(incidents).where(eq(incidents.id, idRow.id)).limit(1);

	await notifySubscribers({
		title,
		status: 'investigating',
		severity,
		updateMessage: initialMessage,
	});

	return row!;
}

export async function addIncidentUpdate(
	incidentId: number,
	status: IncidentStatus,
	message: string,
	byId: string,
): Promise<void> {
	const [row] = await db.select().from(incidents).where(eq(incidents.id, incidentId));
	if (!row) return;
	const existing: IncidentUpdate[] = row.updates ? (JSON.parse(row.updates) as IncidentUpdate[]) : [];
	const update: IncidentUpdate = { status, message, at: new Date().toISOString(), by: byId };
	existing.unshift(update);
	await db
		.update(incidents)
		.set({ status, updates: JSON.stringify(existing) })
		.where(eq(incidents.id, incidentId));

	await notifySubscribers({
		title: row.title,
		status,
		severity: row.severity as IncidentSeverity,
		updateMessage: message,
	});
}

export async function resolveIncident(incidentId: number, message: string, byId: string): Promise<void> {
	const [row] = await db.select().from(incidents).where(eq(incidents.id, incidentId));
	if (!row) return;
	const existing: IncidentUpdate[] = row.updates ? (JSON.parse(row.updates) as IncidentUpdate[]) : [];
	const update: IncidentUpdate = { status: 'resolved', message, at: new Date().toISOString(), by: byId };
	existing.unshift(update);
	await db
		.update(incidents)
		.set({ status: 'resolved', updates: JSON.stringify(existing), resolvedAt: new Date() })
		.where(eq(incidents.id, incidentId));

	await notifySubscribers({
		title: row.title,
		status: 'resolved',
		severity: row.severity as IncidentSeverity,
		updateMessage: message,
	});
}

// ─── Subscriber helpers ────────────────────────────────────────────────────────

export async function subscribeUser(userId: string): Promise<void> {
	await db
		.insert(statusSubscribers)
		.values({ userId })
		.onDuplicateKeyUpdate({ set: { userId: sql`${statusSubscribers.userId}` } });
}

export async function unsubscribeUser(userId: string): Promise<void> {
	await db.delete(statusSubscribers).where(eq(statusSubscribers.userId, userId));
}

export async function isSubscribed(userId: string): Promise<boolean> {
	const [row] = await db.select().from(statusSubscribers).where(eq(statusSubscribers.userId, userId));
	return !!row;
}

export async function getSubscribers(): Promise<(typeof statusSubscribers.$inferSelect)[]> {
	return db.select().from(statusSubscribers);
}

export async function notifySubscribers(incident: {
	title: string;
	status: string;
	severity: IncidentSeverity | 'maintenance';
	updateMessage: string;
}): Promise<void> {
	const subscribers = await getSubscribers();
	if (subscribers.length === 0) return;

	const severityEmoji =
		incident.severity === 'critical'
			? '🔴'
			: incident.severity === 'major'
				? '🟠'
				: incident.severity === 'minor'
					? '🟡'
					: '🔧';

	const statusLabels: Record<string, string> = {
		investigating: 'Investigating',
		identified: 'Identified',
		monitoring: 'Monitoring',
		resolved: 'Resolved ✅',
		maintenance: 'Maintenance 🔧',
		started: 'Started 🔧',
	};
	const statusLabel = statusLabels[incident.status.toLowerCase()] ?? incident.status;

	const content = `${severityEmoji} **Status Update — ${incident.title}**\nStatus: **${statusLabel}**\n\n${incident.updateMessage}`;

	const unsubRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId('status:unsubscribe')
			.setLabel('Unsubscribe from updates')
			.setStyle(ButtonStyle.Danger),
	);

	await Promise.allSettled(
		subscribers.map(async (sub) => {
			try {
				const user = await container.client.users.fetch(sub.userId);
				await user.send({ content, components: [unsubRow] });
			} catch {
				// DMs may be closed; silently skip
			}
		}),
	);
}

// ─── Panel builder ─────────────────────────────────────────────────────────────

export type ServiceStatus = {
	id: string;
	label: string;
	status: 'online' | 'offline' | 'maintenance' | 'degraded' | 'unknown';
	pingMs: number | null;
	uptime: number | null;
	overrideReason: string | null;
	maintenanceUpdates: MaintenanceUpdate[];
};

export type CategoryStatus = {
	id: string;
	label: string;
	services: ServiceStatus[];
};

export async function buildStatusData(
	statusMap: Map<string, { online: boolean; pingMs: number }>,
): Promise<CategoryStatus[]> {
	const config = getStatusConfig();
	const overrides = await getServiceOverrides();

	return Promise.all(
		config.categories.map(async (cat) => ({
			id: cat.id,
			label: cat.label,
			services: await Promise.all(
				cat.services.map(async (svc) => {
					const override = overrides.get(svc.id);
					const autoCheck = statusMap.get(svc.id);
					const status: ServiceStatus['status'] = override
						? override.status
						: autoCheck
							? autoCheck.online
								? 'online'
								: 'offline'
							: 'unknown';
					return {
						id: svc.id,
						label: svc.label,
						status,
						pingMs: autoCheck?.pingMs ?? null,
						uptime: await getUptime(svc.id),
						overrideReason: override?.reason ?? null,
						maintenanceUpdates: override?.updates ?? [],
					};
				}),
			),
		})),
	);
}

function dot(status: ServiceStatus['status']): string {
	if (status === 'online') return '🟢';
	if (status === 'maintenance') return '🔧';
	if (status === 'degraded') return '🟡';
	if (status === 'offline') return '🔴';
	return '⚪';
}

function uptimeStr(uptime: number | null): string {
	if (uptime === null) return '';
	return ` (${uptime.toFixed(2)}%)`;
}

export async function buildStatusPanel(categories: CategoryStatus[], updatedAt: Date) {
	const activeIncidents = await getActiveIncidents();

	const allOnline = categories.every((c) => c.services.every((s) => s.status === 'online'));
	const anyOffline = categories.some((c) => c.services.some((s) => s.status === 'offline'));
	const anyDegraded = categories.some((c) => c.services.some((s) => s.status === 'degraded'));
	const anyMaintenance = categories.some((c) => c.services.some((s) => s.status === 'maintenance'));
	const hasCriticalIncident = activeIncidents.some((i) => i.severity === 'critical');
	const hasMajorIncident = activeIncidents.some((i) => i.severity === 'major');
	const hasMinorIncident = activeIncidents.some((i) => i.severity === 'minor');

	const overallColor =
		hasCriticalIncident || anyOffline
			? Colors.Error
			: hasMajorIncident
				? Colors.Error
				: anyDegraded || hasMinorIncident
					? Colors.Warning
					: allOnline
						? Colors.Success
						: Colors.Warning;

	const overallLabel =
		hasCriticalIncident || (anyOffline && hasMajorIncident)
			? '🔴 Major Outage'
			: anyOffline || hasMajorIncident
				? '🔴 Partial Outage Detected'
				: anyDegraded || hasMinorIncident
					? '🟡 Degraded Performance'
					: anyMaintenance
						? '🔧 Partial Maintenance'
						: allOnline
							? '🟢 All Systems Operational'
							: '🟡 Degraded Performance';

	const panelContainer = makeContainer({ color: overallColor });

	// ── Overall status ───────────────────────────────────────────────────────────
	panelContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### System Status\n${overallLabel}`));

	panelContainer.addSeparatorComponents(separator());

	// ── Active incidents ─────────────────────────────────────────────────────────
	if (activeIncidents.length > 0) {
		const severityEmoji = (s: IncidentSeverity) =>
			s === 'critical' ? '🔴' : s === 'major' ? '🟠' : s === 'minor' ? '🟡' : '🔧';
		const statusBadge: Record<IncidentStatus, string> = {
			investigating: 'Investigating',
			identified: 'Identified',
			monitoring: 'Monitoring',
			resolved: 'Resolved',
		};

		for (const incident of activeIncidents) {
			const updates: IncidentUpdate[] = incident.updates ? (JSON.parse(incident.updates) as IncidentUpdate[]) : [];
			const latest = updates[0];
			const ts = Math.floor(new Date(incident.startedAt).getTime() / 1000);

			let text = `**${severityEmoji(incident.severity as IncidentSeverity)} ${incident.title}**`;
			text += `\n-# ${statusBadge[incident.status as IncidentStatus]} • Started <t:${ts}:R>`;
			if (latest) text += `\n${latest.message}`;

			panelContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
		}

		panelContainer.addSeparatorComponents(separator());
	}

	// ── Per-category services ────────────────────────────────────────────────────
	for (let i = 0; i < categories.length; i++) {
		const cat = categories[i];
		const lines = cat.services.map((s) => {
			let line = `${dot(s.status)} **${s.label}**${uptimeStr(s.uptime)}`;
			if (s.overrideReason) line += ` — *${s.overrideReason}*`;
			if (s.status === 'maintenance' && s.maintenanceUpdates.length > 0) {
				const updateLines = s.maintenanceUpdates
					.slice(0, 3)
					.map((u) => `-# • <t:${Math.floor(new Date(u.at).getTime() / 1000)}:t> ${u.message}`)
					.join('\n');
				line += `\n${updateLines}`;
			}
			return line;
		});

		panelContainer.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(`### ${cat.label}\n${lines.join('\n')}`),
		);

		if (i < categories.length - 1) panelContainer.addSeparatorComponents(separator());
	}

	panelContainer.addSeparatorComponents(separator());
	panelContainer.addTextDisplayComponents(
		new TextDisplayBuilder().setContent(
			`-# Last updated: <t:${Math.floor(updatedAt.getTime() / 1000)}:R> • Uptime over 30 days`,
		),
	);

	const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId('status:refresh')
			.setLabel('Refresh')
			.setStyle(ButtonStyle.Secondary)
			.setEmoji('🔄'),
		new ButtonBuilder()
			.setCustomId('status:subscribe')
			.setLabel('Subscribe to Updates')
			.setStyle(ButtonStyle.Secondary)
			.setEmoji('🔔'),
	);

	return { container: panelContainer, row, flags: CV2_FLAG };
}
