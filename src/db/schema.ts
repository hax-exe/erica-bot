import { sql } from 'drizzle-orm';
import { boolean, datetime, int, mysqlTable, text, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';

// Per-guild configuration
export const guilds = mysqlTable('guilds', {
	id: varchar('id', { length: 64 }).primaryKey(), // guild snowflake
	logWebhookUrl: text('log_webhook_url'),
	modLogWebhookUrl: text('mod_log_webhook_url'),
	ticketLogWebhookUrl: text('ticket_log_webhook_url'),
	reportWebhookUrl: text('report_webhook_url'),
	logIgnoredChannelIds: text('log_ignored_channel_ids').notNull().default('[]'), // JSON: string[]
	// Channel IDs mirrored from webhook setup — used by the dashboard for display
	logChannelId: varchar('log_channel_id', { length: 64 }),
	modLogChannelId: varchar('mod_log_channel_id', { length: 64 }),
	ticketLogChannelId: varchar('ticket_log_channel_id', { length: 64 }),
	reportChannelId: varchar('report_channel_id', { length: 64 }),
	ttsConflictMode: varchar('tts_conflict_mode', { length: 64 })
		.$type<'block' | 'interrupt'>()
		.notNull()
		.default('block'),
	ttsRoleId: varchar('tts_role_id', { length: 64 }),
	ttsDefaultLanguage: varchar('tts_default_language', { length: 64 }).notNull().default('en'),
	musicChannelId: varchar('music_channel_id', { length: 64 }),
	musicMessageId: varchar('music_message_id', { length: 64 }),
	maxVolumeLimit: int('max_volume_limit').notNull().default(100),
	autoplaySource: varchar('autoplay_source', { length: 64 })
		.$type<'spotify' | 'youtube'>()
		.notNull()
		.default('spotify'),
	autoplayEnabled: boolean('autoplay_enabled').notNull().default(false),
	warnDecayDays: int('warn_decay_days'),
	proofRequired: boolean('proof_required').notNull().default(false),
	requireReview: boolean('require_review').notNull().default(false),
});

// Infraction types
export type InfractionType = 'ban' | 'unban' | 'kick' | 'timeout' | 'untimeout' | 'softban' | 'warn';

// Moderation infractions
export const infractions = mysqlTable(
	'infractions',
	{
		id: int('id').autoincrement().primaryKey(),
		guildId: varchar('guild_id', { length: 64 }).notNull(),
		userId: varchar('user_id', { length: 64 }).notNull(),
		moderatorId: varchar('moderator_id', { length: 64 }).notNull(),
		type: varchar('type', { length: 64 }).$type<InfractionType>().notNull(),
		reason: text('reason').notNull().default('No reason provided'),
		duration: int('duration'), // milliseconds, null if permanent
		caseId: varchar('case_id', { length: 64 }).notNull(),
		createdAt: datetime('created_at', { mode: 'date' }).notNull().default(sql`CURRENT_TIMESTAMP`),
		untimeoutLogged: boolean('untimeout_logged').notNull().default(false),
		originalReason: text('original_reason'), // set on first edit
		editedAt: datetime('edited_at', { mode: 'date' }),
		editedById: varchar('edited_by_id', { length: 64 }),
		proofUrl: text('proof_url'),
		linkedCaseId: varchar('linked_case_id', { length: 64 }),
	},
	(t) => [uniqueIndex('infractions_case_id_uniq').on(t.caseId)],
);

// Moderator notes — internal notes attached to a user, not shown as public infractions
export const modNotes = mysqlTable('mod_notes', {
	id: int('id').autoincrement().primaryKey(),
	guildId: varchar('guild_id', { length: 64 }).notNull(),
	userId: varchar('user_id', { length: 64 }).notNull(),
	moderatorId: varchar('moderator_id', { length: 64 }).notNull(),
	content: text('content').notNull(),
	createdAt: datetime('created_at', { mode: 'date' }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Ticket status
export type TicketStatus = 'open' | 'closed';

// Welcome message settings (per-guild)
export const welcomeSettings = mysqlTable('welcome_settings', {
	guildId: varchar('guild_id', { length: 64 }).primaryKey(),
	enabled: boolean('enabled').notNull().default(false),
	channelId: varchar('channel_id', { length: 64 }),
	message: text('message'),
	title: text('title'),
	color: int('color'),
	footer: text('footer'),
	showAvatar: boolean('show_avatar').notNull().default(true),
	autoroleId: varchar('autorole_id', { length: 64 }),
	dmEnabled: boolean('dm_enabled').notNull().default(false),
	dmMessage: text('dm_message'),
});

// Leave message settings (per-guild)
export const leaveSettings = mysqlTable('leave_settings', {
	guildId: varchar('guild_id', { length: 64 }).primaryKey(),
	enabled: boolean('enabled').notNull().default(false),
	channelId: varchar('channel_id', { length: 64 }),
	message: text('message'),
	title: text('title'),
	color: int('color'),
	footer: text('footer'),
});

// Support blacklist (per-guild)
export const supportBlacklist = mysqlTable('support_blacklist', {
	id: int('id').autoincrement().primaryKey(),
	guildId: varchar('guild_id', { length: 64 }).notNull(),
	userId: varchar('user_id', { length: 64 }).notNull(),
	reason: text('reason').notNull().default('No reason provided'),
	addedById: varchar('added_by_id', { length: 64 }).notNull(),
	createdAt: datetime('created_at', { mode: 'date' }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Global bot blacklist
export const botBlacklist = mysqlTable('bot_blacklist', {
	userId: varchar('user_id', { length: 64 }).primaryKey(),
	reason: text('reason').notNull().default('No reason provided'),
	addedById: varchar('added_by_id', { length: 64 }).notNull(),
	createdAt: datetime('created_at', { mode: 'date' }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Support tickets (open/closed channel state — panel/categories live in config/tickets.yml)
export const tickets = mysqlTable('tickets', {
	id: int('id').autoincrement().primaryKey(),
	guildId: varchar('guild_id', { length: 64 }).notNull(),
	userId: varchar('user_id', { length: 64 }).notNull(),
	channelId: varchar('channel_id', { length: 64 }).notNull(),
	categoryId: varchar('category_id', { length: 64 }).notNull(),
	status: varchar('status', { length: 64 }).$type<TicketStatus>().notNull().default('open'),
	transcriptCode: varchar('transcript_code', { length: 64 }),
	createdAt: datetime('created_at', { mode: 'date' }).notNull().default(sql`CURRENT_TIMESTAMP`),
	closedAt: datetime('closed_at', { mode: 'date' }),
	closedById: varchar('closed_by_id', { length: 64 }),
	claimedById: varchar('claimed_by_id', { length: 64 }),
	lastActivityAt: datetime('last_activity_at', { mode: 'date' }).notNull().default(sql`CURRENT_TIMESTAMP`),
	inactivityWarningSent: boolean('inactivity_warning_sent').notNull().default(false),
});

// Review settings (per-guild)
export const reviewSettings = mysqlTable('review_settings', {
	guildId: varchar('guild_id', { length: 64 }).primaryKey(),
	enabled: boolean('enabled').notNull().default(false),
	channelId: varchar('channel_id', { length: 64 }),
});

// Ticket reviews
export const ticketReviews = mysqlTable('ticket_reviews', {
	id: int('id').autoincrement().primaryKey(),
	ticketId: int('ticket_id').notNull().unique(),
	guildId: varchar('guild_id', { length: 64 }).notNull(),
	userId: varchar('user_id', { length: 64 }).notNull(),
	rating: int('rating').notNull(),
	comment: text('comment'),
	createdAt: datetime('created_at', { mode: 'date' }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Moderation presets (autocomplete reasons)
export const moderationPresets = mysqlTable('moderation_presets', {
	id: int('id').autoincrement().primaryKey(),
	guildId: varchar('guild_id', { length: 64 }).notNull(),
	reason: text('reason').notNull(),
});

// Reaction role panels
export const rrPanels = mysqlTable('rr_panels', {
	id: int('id').autoincrement().primaryKey(),
	guildId: varchar('guild_id', { length: 64 }).notNull(),
	channelId: varchar('channel_id', { length: 64 }).notNull(),
	messageId: varchar('message_id', { length: 64 }).notNull(),
	title: text('title').notNull().default('Role Selection'),
	description: text('description'),
	mode: varchar('mode', { length: 64 }).notNull().default('select'), // 'select' | 'buttons'
});

// Roles available in a panel
export const rrPanelRoles = mysqlTable('rr_panel_roles', {
	id: int('id').autoincrement().primaryKey(),
	panelId: int('panel_id').notNull(),
	roleId: varchar('role_id', { length: 64 }).notNull(),
	label: varchar('label', { length: 255 }).notNull(),
	description: text('description'),
	emoji: varchar('emoji', { length: 64 }),
});

// Starboard settings (per-guild)
export const starboardSettings = mysqlTable('starboard_settings', {
	guildId: varchar('guild_id', { length: 64 }).primaryKey(),
	enabled: boolean('enabled').notNull().default(false),
	channelId: varchar('channel_id', { length: 64 }),
	emoji: varchar('emoji', { length: 64 }).notNull().default('⭐'),
	threshold: int('threshold').notNull().default(3),
});

// Starboard entries
export const starboardEntries = mysqlTable('starboard_entries', {
	id: int('id').autoincrement().primaryKey(),
	guildId: varchar('guild_id', { length: 64 }).notNull(),
	sourceMessageId: varchar('source_message_id', { length: 64 }).notNull().unique(),
	starboardMessageId: varchar('starboard_message_id', { length: 64 }).notNull(),
	authorId: varchar('author_id', { length: 64 }).notNull(),
	channelId: varchar('channel_id', { length: 64 }).notNull(),
	createdAt: datetime('created_at', { mode: 'date' }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Birthday settings (per-guild)
export const birthdaySettings = mysqlTable('birthday_settings', {
	guildId: varchar('guild_id', { length: 64 }).primaryKey(),
	enabled: boolean('enabled').notNull().default(false),
	channelId: varchar('channel_id', { length: 64 }),
	roleId: varchar('role_id', { length: 64 }),
	message: text('message'),
});

// User birthdays
export const birthdays = mysqlTable('birthdays', {
	id: int('id').autoincrement().primaryKey(),
	userId: varchar('user_id', { length: 64 }).notNull(),
	guildId: varchar('guild_id', { length: 64 }).notNull(),
	month: int('month').notNull(),
	day: int('day').notNull(),
	year: int('year'),
	lastWished: varchar('last_wished', { length: 64 }),
});

// Temporary voice channel settings (per-guild)
export const spaceSettings = mysqlTable('space_settings', {
	guildId: varchar('guild_id', { length: 64 }).primaryKey(),
	enabled: boolean('enabled').notNull().default(false),
	triggerChannelId: varchar('trigger_channel_id', { length: 64 }),
	categoryId: varchar('category_id', { length: 64 }),
	userLimit: int('user_limit').notNull().default(0),
	nameTemplate: text('name_template'),
});

// Active temporary voice channels
export const activeSpaces = mysqlTable('active_spaces', {
	channelId: varchar('channel_id', { length: 64 }).primaryKey(),
	guildId: varchar('guild_id', { length: 64 }).notNull(),
	ownerId: varchar('owner_id', { length: 64 }).notNull(),
	createdAt: datetime('created_at', { mode: 'date' }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Tags (per-guild)
export const tags = mysqlTable('tags', {
	id: int('id').autoincrement().primaryKey(),
	guildId: varchar('guild_id', { length: 64 }).notNull(),
	name: varchar('name', { length: 255 }).notNull(),
	aliases: text('aliases').notNull().default('[]'),
	content: text('content'),
	embed: text('embed'),
	createdAt: datetime('created_at', { mode: 'date' }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Autoresponder rules (per-guild keyword → reply)
export type AutoresponderMatchMode = 'exact' | 'contains' | 'starts_with' | 'ends_with' | 'regex';

export const autoresponders = mysqlTable(
	'autoresponders',
	{
		id: int('id').autoincrement().primaryKey(),
		guildId: varchar('guild_id', { length: 64 }).notNull(),
		name: varchar('name', { length: 255 }).notNull(),
		trigger: text('trigger').notNull(),
		matchMode: varchar('match_mode', { length: 255 }).$type<AutoresponderMatchMode>().notNull().default('contains'),
		response: text('response').notNull(),
		enabled: boolean('enabled').notNull().default(true),
		cooldownSeconds: int('cooldown_seconds').notNull().default(10),
		/** JSON string array of channel IDs; empty = all channels */
		channelIds: text('channel_ids').notNull().default('[]'),
		replyToMessage: boolean('reply_to_message').notNull().default(true),
		createdBy: varchar('created_by', { length: 255 }).notNull(),
		createdAt: datetime('created_at', { mode: 'date' }).notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(t) => [uniqueIndex('autoresponders_guild_name_uniq').on(t.guildId, t.name)],
);

// ─── Leveling ─────────────────────────────────────────────────────────────────

export const xp = mysqlTable(
	'xp',
	{
		id: int('id').autoincrement().primaryKey(),
		guildId: varchar('guild_id', { length: 64 }).notNull(),
		userId: varchar('user_id', { length: 64 }).notNull(),
		totalXp: int('total_xp').notNull().default(0),
		level: int('level').notNull().default(0),
		lastMessageAt: int('last_message_at'), // unix ms, null until first message
		accentColor: varchar('accent_color', { length: 64 }),
		backgroundType: varchar('background_type', { length: 64 })
			.$type<'color' | 'image' | 'preset'>()
			.notNull()
			.default('color'),
		backgroundValue: varchar('background_value', { length: 64 }),
	},
	(t) => [uniqueIndex('xp_guild_user_uniq').on(t.guildId, t.userId)],
);

export const levelSettings = mysqlTable('level_settings', {
	guildId: varchar('guild_id', { length: 64 }).primaryKey(),
	enabled: boolean('enabled').notNull().default(true),
	xpMin: int('xp_min').notNull().default(15),
	xpMax: int('xp_max').notNull().default(25),
	cooldownSeconds: int('cooldown_seconds').notNull().default(60),
	levelUpChannelId: varchar('level_up_channel_id', { length: 64 }),
	levelUpMessage: text('level_up_message').notNull().default('🎉 {mention} leveled up to **level {level}**!'),
	noXpRoleIds: text('no_xp_role_ids').notNull().default('[]'),
	noXpChannelIds: text('no_xp_channel_ids').notNull().default('[]'),
	voiceXpEnabled: boolean('voice_xp_enabled').notNull().default(true),
	voiceXpPerMinute: int('voice_xp_per_minute').notNull().default(3),
	voiceMinMembers: int('voice_min_members').notNull().default(1),
	noXpVoiceChannelIds: text('no_xp_voice_channel_ids').notNull().default('[]'),
});

export const levelRoles = mysqlTable(
	'level_roles',
	{
		id: int('id').autoincrement().primaryKey(),
		guildId: varchar('guild_id', { length: 64 }).notNull(),
		level: int('level').notNull(),
		roleId: varchar('role_id', { length: 64 }).notNull(),
	},
	(t) => [uniqueIndex('level_roles_uniq').on(t.guildId, t.level, t.roleId)],
);

export const levelBadges = mysqlTable(
	'level_badges',
	{
		id: int('id').autoincrement().primaryKey(),
		guildId: varchar('guild_id', { length: 64 }).notNull(),
		roleId: varchar('role_id', { length: 64 }).notNull(),
		label: varchar('label', { length: 255 }).notNull(),
		color: varchar('color', { length: 255 }).notNull().default('#5865F2'),
		emoji: varchar('emoji', { length: 64 }),
		priority: int('priority').notNull().default(0),
	},
	(t) => [uniqueIndex('level_badges_guild_role_uniq').on(t.guildId, t.roleId)],
);

// Per-guild module toggles
export const guildModules = mysqlTable('guild_modules', {
	guildId: varchar('guild_id', { length: 64 }).primaryKey(),
	leveling: boolean('leveling').notNull().default(true),
	welcomer: boolean('welcomer').notNull().default(true),
	starboard: boolean('starboard').notNull().default(true),
	birthdays: boolean('birthdays').notNull().default(true),
	spaces: boolean('spaces').notNull().default(true),
	sticky: boolean('sticky').notNull().default(true),
	tickets: boolean('tickets').notNull().default(true),
	tags: boolean('tags').notNull().default(true),
	logging: boolean('logging').notNull().default(true),
	music: boolean('music').notNull().default(true),
	reactionRoles: boolean('reaction_roles').notNull().default(true),
	reports: boolean('reports').notNull().default(true),
	reviews: boolean('reviews').notNull().default(true),
	verification: boolean('verification').notNull().default(true),
	automod: boolean('automod').notNull().default(false),
	suggestions: boolean('suggestions').notNull().default(true),
	fun: boolean('fun').notNull().default(true),
	giveaways: boolean('giveaways').notNull().default(true),
	economy: boolean('economy').notNull().default(true),
	tts: boolean('tts').notNull().default(true),
	autoresponder: boolean('autoresponder').notNull().default(true),
});

// Global module overrides — singleton row (id=1)
export const globalModules = mysqlTable('global_modules', {
	id: int('id').primaryKey(),
	leveling: boolean('leveling').notNull().default(true),
	welcomer: boolean('welcomer').notNull().default(true),
	starboard: boolean('starboard').notNull().default(true),
	birthdays: boolean('birthdays').notNull().default(true),
	spaces: boolean('spaces').notNull().default(true),
	sticky: boolean('sticky').notNull().default(true),
	tickets: boolean('tickets').notNull().default(true),
	tags: boolean('tags').notNull().default(true),
	logging: boolean('logging').notNull().default(true),
	music: boolean('music').notNull().default(true),
	reactionRoles: boolean('reaction_roles').notNull().default(true),
	reports: boolean('reports').notNull().default(true),
	reviews: boolean('reviews').notNull().default(true),
	verification: boolean('verification').notNull().default(true),
	automod: boolean('automod').notNull().default(false),
	suggestions: boolean('suggestions').notNull().default(true),
	fun: boolean('fun').notNull().default(true),
	giveaways: boolean('giveaways').notNull().default(true),
	economy: boolean('economy').notNull().default(true),
	tts: boolean('tts').notNull().default(true),
	autoresponder: boolean('autoresponder').notNull().default(true),
});

// Maintenance mode — singleton row (id=1)
export const maintenanceState = mysqlTable('maintenance_state', {
	id: int('id').primaryKey(),
	enabled: boolean('enabled').notNull().default(false),
	reason: text('reason'),
	updates: text('updates').notNull().default('[]'),
	startedAt: datetime('started_at', { mode: 'date' }),
});

// Incidents
export type IncidentStatus = 'investigating' | 'identified' | 'monitoring' | 'resolved';
export type IncidentSeverity = 'minor' | 'major' | 'critical' | 'maintenance';
export type IncidentUpdate = { status: IncidentStatus; message: string; at: string; by: string };

export const incidents = mysqlTable('incidents', {
	id: int('id').autoincrement().primaryKey(),
	title: text('title').notNull(),
	status: varchar('status', { length: 64 }).$type<IncidentStatus>().notNull().default('investigating'),
	severity: varchar('severity', { length: 255 }).$type<IncidentSeverity>().notNull().default('minor'),
	affectedServiceIds: text('affected_service_ids').notNull().default('[]'),
	updates: text('updates').notNull().default('[]'),
	startedAt: datetime('started_at', { mode: 'date' }).notNull().default(sql`CURRENT_TIMESTAMP`),
	resolvedAt: datetime('resolved_at', { mode: 'date' }),
	createdById: varchar('created_by_id', { length: 64 }).notNull(),
});

// Status DM subscribers
export const statusSubscribers = mysqlTable('status_subscribers', {
	userId: varchar('user_id', { length: 64 }).primaryKey(),
	subscribedAt: datetime('subscribed_at', { mode: 'date' }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Manual service status overrides
export type OverrideStatus = 'online' | 'offline' | 'maintenance' | 'degraded';
export const serviceOverrides = mysqlTable('service_overrides', {
	serviceId: varchar('service_id', { length: 64 }).primaryKey(),
	status: varchar('status', { length: 64 }).$type<OverrideStatus>().notNull(),
	reason: text('reason'),
	updates: text('updates').notNull().default('[]'),
	setById: varchar('set_by_id', { length: 64 }).notNull(),
	setAt: datetime('set_at', { mode: 'date' }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Status monitoring checks
export const statusChecks = mysqlTable('status_checks', {
	id: int('id').autoincrement().primaryKey(),
	serviceId: varchar('service_id', { length: 64 }).notNull(),
	online: boolean('online').notNull(),
	pingMs: int('ping_ms'),
	checkedAt: datetime('checked_at', { mode: 'date' }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Status panel location
export const statusPanel = mysqlTable('status_panel', {
	id: int('id').primaryKey(),
	channelId: varchar('channel_id', { length: 64 }).notNull(),
	messageId: varchar('message_id', { length: 64 }).notNull(),
	guildId: varchar('guild_id', { length: 64 }).notNull(),
});

// Minecraft username links
export const minecraftLinks = mysqlTable('minecraft_links', {
	userId: varchar('user_id', { length: 64 }).primaryKey(),
	minecraftName: varchar('minecraft_name', { length: 255 }).notNull(),
	minecraftUuid: varchar('minecraft_uuid', { length: 64 }),
	linkedAt: datetime('linked_at', { mode: 'date' }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Pending Minecraft verifications
export const pendingVerifications = mysqlTable('pending_verifications', {
	userId: varchar('user_id', { length: 64 }).primaryKey(),
	guildId: varchar('guild_id', { length: 64 }).notNull(),
	code: varchar('code', { length: 64 }).notNull(),
	expiresAt: datetime('expires_at', { mode: 'date' }).notNull(),
});

// Sticky messages
export const stickyMessages = mysqlTable('sticky_messages', {
	channelId: varchar('channel_id', { length: 64 }).primaryKey(),
	guildId: varchar('guild_id', { length: 64 }).notNull(),
	content: text('content').notNull(),
	lastMessageId: varchar('last_message_id', { length: 64 }),
	enabled: boolean('enabled').notNull().default(true),
	expiresAt: datetime('expires_at', { mode: 'date' }),
});

// Preset badge role assignments
export const presetBadgeRoles = mysqlTable(
	'preset_badge_roles',
	{
		id: int('id').autoincrement().primaryKey(),
		preset: varchar('preset', { length: 64 }).notNull(),
		roleId: varchar('role_id', { length: 64 }).notNull(),
		emoji: varchar('emoji', { length: 64 }),
	},
	(t) => [uniqueIndex('preset_badge_roles_uniq').on(t.preset)],
);

// AutoMod per-guild settings
export const automodSettings = mysqlTable('automod_settings', {
	guildId: varchar('guild_id', { length: 64 }).primaryKey(),
	wordFilterEnabled: boolean('word_filter_enabled').notNull().default(false),
	wordFilterAction: varchar('word_filter_action', { length: 255 }).notNull().default('delete'),
	wordFilterTimeoutMinutes: int('word_filter_timeout_minutes').notNull().default(5),
	spamEnabled: boolean('spam_enabled').notNull().default(false),
	spamMaxMessages: int('spam_max_messages').notNull().default(5),
	spamWindowSeconds: int('spam_window_seconds').notNull().default(5),
	spamAction: varchar('spam_action', { length: 255 }).notNull().default('delete_timeout'),
	spamTimeoutMinutes: int('spam_timeout_minutes').notNull().default(5),
	capsEnabled: boolean('caps_enabled').notNull().default(false),
	capsPercent: int('caps_percent').notNull().default(70),
	capsMinLength: int('caps_min_length').notNull().default(8),
	capsAction: varchar('caps_action', { length: 255 }).notNull().default('delete'),
	capsTimeoutMinutes: int('caps_timeout_minutes').notNull().default(5),
	linkEnabled: boolean('link_enabled').notNull().default(false),
	linkAction: varchar('link_action', { length: 255 }).notNull().default('delete'),
	linkTimeoutMinutes: int('link_timeout_minutes').notNull().default(5),
	linkWhitelist: text('link_whitelist').notNull().default('[]'),
	inviteEnabled: boolean('invite_enabled').notNull().default(false),
	inviteAction: varchar('invite_action', { length: 255 }).notNull().default('delete'),
	inviteTimeoutMinutes: int('invite_timeout_minutes').notNull().default(5),
	mentionEnabled: boolean('mention_enabled').notNull().default(false),
	mentionMax: int('mention_max').notNull().default(5),
	mentionAction: varchar('mention_action', { length: 255 }).notNull().default('delete_warn'),
	mentionTimeoutMinutes: int('mention_timeout_minutes').notNull().default(10),
	newAccountEnabled: boolean('new_account_enabled').notNull().default(false),
	newAccountAgeDays: int('new_account_age_days').notNull().default(7),
	newAccountAction: varchar('new_account_action', { length: 255 }).notNull().default('delete'),
	newAccountTimeoutMinutes: int('new_account_timeout_minutes').notNull().default(10),
	exemptRoles: text('exempt_roles').notNull().default('[]'),
	exemptChannels: text('exempt_channels').notNull().default('[]'),
});

// ─── Suggestions ─────────────────────────────────────────────────────────────

export const suggestionSettings = mysqlTable('suggestion_settings', {
	guildId: varchar('guild_id', { length: 64 }).primaryKey(),
	channelId: varchar('channel_id', { length: 64 }),
	dmOnUpdate: boolean('dm_on_update').notNull().default(true),
});

export type SuggestionStatus = 'pending' | 'approved' | 'denied' | 'implemented';

export const suggestions = mysqlTable('suggestions', {
	id: int('id').autoincrement().primaryKey(),
	guildId: varchar('guild_id', { length: 64 }).notNull(),
	userId: varchar('user_id', { length: 64 }).notNull(),
	channelId: varchar('channel_id', { length: 64 }).notNull(),
	messageId: varchar('message_id', { length: 64 }).notNull(),
	content: text('content').notNull(),
	status: varchar('status', { length: 64 }).$type<SuggestionStatus>().notNull().default('pending'),
	reviewedById: varchar('reviewed_by_id', { length: 64 }),
	reviewReason: text('review_reason'),
	upvotes: int('upvotes').notNull().default(0),
	downvotes: int('downvotes').notNull().default(0),
	createdAt: datetime('created_at', { mode: 'date' }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const suggestionVotes = mysqlTable(
	'suggestion_votes',
	{
		id: int('id').autoincrement().primaryKey(),
		suggestionId: int('suggestion_id').notNull(),
		userId: varchar('user_id', { length: 64 }).notNull(),
		vote: varchar('vote', { length: 255 }).$type<'up' | 'down'>().notNull(),
	},
	(t) => [uniqueIndex('suggestion_votes_uniq').on(t.suggestionId, t.userId)],
);

// AutoMod word filter entries
export const automodWordFilter = mysqlTable(
	'automod_word_filter',
	{
		id: int('id').autoincrement().primaryKey(),
		guildId: varchar('guild_id', { length: 64 }).notNull(),
		word: varchar('word', { length: 255 }).notNull(),
		isRegex: boolean('is_regex').notNull().default(false),
		addedAt: datetime('added_at', { mode: 'date' }).notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(t) => [uniqueIndex('automod_word_filter_uniq').on(t.guildId, t.word)],
);

// Counting channel settings
export const countingSettings = mysqlTable('counting_settings', {
	guildId: varchar('guild_id', { length: 64 }).primaryKey(),
	channelId: varchar('channel_id', { length: 64 }),
	currentCount: int('current_count').notNull().default(0),
	lastUserId: varchar('last_user_id', { length: 64 }),
	highScore: int('high_score').notNull().default(0),
	resetOnFail: boolean('reset_on_fail').notNull().default(true),
	enabled: boolean('enabled').notNull().default(false),
});

// ─── Giveaways ─────────────────────────────────────────────────────────────────

export type GiveawayBonusRole = { roleId: string; multiplier: number };

export const giveaways = mysqlTable('giveaways', {
	id: int('id').autoincrement().primaryKey(),
	guildId: varchar('guild_id', { length: 64 }).notNull(),
	channelId: varchar('channel_id', { length: 64 }).notNull(),
	messageId: varchar('message_id', { length: 64 }).notNull(),
	prize: varchar('prize', { length: 255 }).notNull(),
	winnerCount: int('winner_count').notNull().default(1),
	hostId: varchar('host_id', { length: 64 }).notNull(),
	endsAt: datetime('ends_at', { mode: 'date' }).notNull(),
	ended: boolean('ended').notNull().default(false),
	winnerIds: text('winner_ids').notNull().default('[]'), // JSON: string[]
	entrantIds: text('entrant_ids').notNull().default('[]'), // JSON: string[]
	bonusRoles: text('bonus_roles').notNull().default('[]'), // JSON: GiveawayBonusRole[]
	requiredRoleId: varchar('required_role_id', { length: 64 }),
	cancelled: boolean('cancelled').notNull().default(false),
	createdAt: datetime('created_at', { mode: 'date' }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ─── AFK Statuses ──────────────────────────────────────────────────────────────

export const afkStatuses = mysqlTable(
	'afk_statuses',
	{
		id: int('id').autoincrement().primaryKey(),
		userId: varchar('user_id', { length: 64 }).notNull(),
		guildId: varchar('guild_id', { length: 64 }).notNull(),
		reason: text('reason').notNull().default('AFK'),
		setAt: datetime('set_at', { mode: 'date' }).notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(t) => [uniqueIndex('afk_statuses_uniq').on(t.userId, t.guildId)],
);

// ─── Reminders ─────────────────────────────────────────────────────────────────

export const reminders = mysqlTable('reminders', {
	id: int('id').autoincrement().primaryKey(),
	userId: varchar('user_id', { length: 64 }).notNull(),
	channelId: varchar('channel_id', { length: 64 }).notNull(),
	guildId: varchar('guild_id', { length: 64 }),
	content: text('content').notNull(),
	remindAt: datetime('remind_at', { mode: 'date' }).notNull(),
	intervalMs: int('interval_ms'), // non-null = recurring
	done: boolean('done').notNull().default(false),
	createdAt: datetime('created_at', { mode: 'date' }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ─── Server Stats Channels ─────────────────────────────────────────────────────

export const statsChannels = mysqlTable('stats_channels', {
	guildId: varchar('guild_id', { length: 64 }).primaryKey(),
	memberCountChannelId: varchar('member_count_channel_id', { length: 64 }),
	onlineCountChannelId: varchar('online_count_channel_id', { length: 64 }),
	botCountChannelId: varchar('bot_count_channel_id', { length: 64 }),
	channelCountChannelId: varchar('channel_count_channel_id', { length: 64 }),
});

// ─── Economy ───────────────────────────────────────────────────────────────────

export const economy = mysqlTable(
	'economy',
	{
		id: int('id').autoincrement().primaryKey(),
		userId: varchar('user_id', { length: 64 }).notNull(),
		guildId: varchar('guild_id', { length: 64 }).notNull(),
		balance: int('balance').notNull().default(0), // wallet — robbable
		bank: int('bank').notNull().default(0),
		bankCap: int('bank_cap').notNull().default(5000),
		dailyStreak: int('daily_streak').notNull().default(0),
		lastDailyAt: datetime('last_daily_at', { mode: 'date' }),
		lastWorkAt: datetime('last_work_at', { mode: 'date' }),
		lastCrimeAt: datetime('last_crime_at', { mode: 'date' }),
		lastRobAt: datetime('last_rob_at', { mode: 'date' }),
		padlockExpiresAt: datetime('padlock_expires_at', { mode: 'date' }),
		workBoostExpiresAt: datetime('work_boost_expires_at', { mode: 'date' }),
		lastFishAt: datetime('last_fish_at', { mode: 'date' }),
		lastMineAt: datetime('last_mine_at', { mode: 'date' }),
	},
	(t) => [uniqueIndex('economy_guild_user_uniq').on(t.guildId, t.userId)],
);

// ─── Temp Bans ─────────────────────────────────────────────────────────────────

export const tempbans = mysqlTable('tempbans', {
	id: int('id').autoincrement().primaryKey(),
	guildId: varchar('guild_id', { length: 64 }).notNull(),
	userId: varchar('user_id', { length: 64 }).notNull(),
	expiresAt: datetime('expires_at', { mode: 'date' }).notNull(),
	caseId: varchar('case_id', { length: 64 }).notNull(),
	createdAt: datetime('created_at', { mode: 'date' }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ─── Warn Escalation ───────────────────────────────────────────────────────────

export const warnEscalation = mysqlTable(
	'warn_escalation',
	{
		id: int('id').autoincrement().primaryKey(),
		guildId: varchar('guild_id', { length: 64 }).notNull(),
		threshold: int('threshold').notNull(),
		action: varchar('action', { length: 64 }).$type<'timeout' | 'kick' | 'ban'>().notNull(),
		durationMs: int('duration_ms'),
	},
	(t) => [uniqueIndex('warn_escalation_uniq').on(t.guildId, t.threshold)],
);

// ─── Trivia Scores ─────────────────────────────────────────────────────────────

export const triviaScores = mysqlTable(
	'trivia_scores',
	{
		id: int('id').autoincrement().primaryKey(),
		guildId: varchar('guild_id', { length: 64 }).notNull(),
		userId: varchar('user_id', { length: 64 }).notNull(),
		wins: int('wins').notNull().default(0),
		total: int('total').notNull().default(0),
	},
	(t) => [uniqueIndex('trivia_scores_uniq').on(t.guildId, t.userId)],
);

// ─── Shop Items ────────────────────────────────────────────────────────────────

export const shopItems = mysqlTable(
	'shop_items',
	{
		id: int('id').autoincrement().primaryKey(),
		guildId: varchar('guild_id', { length: 64 }).notNull(),
		name: varchar('name', { length: 255 }).notNull(),
		description: text('description'),
		cost: int('cost').notNull(),
		roleId: varchar('role_id', { length: 64 }),
		type: varchar('type', { length: 64 }).$type<'role' | 'consumable'>().notNull().default('role'),
		itemKey: varchar('item_key', { length: 64 }), // known keys: 'padlock'
		durationHours: int('duration_hours'),
	},
	(t) => [uniqueIndex('shop_items_uniq').on(t.guildId, t.name)],
);

// ─── Economy Transactions ──────────────────────────────────────────────────────

export const economyTransactions = mysqlTable('economy_transactions', {
	id: int('id').autoincrement().primaryKey(),
	guildId: varchar('guild_id', { length: 64 }).notNull(),
	userId: varchar('user_id', { length: 64 }).notNull(),
	type: varchar('type', { length: 64 })
		.$type<
			| 'daily'
			| 'pay_sent'
			| 'pay_received'
			| 'shop_buy'
			| 'work'
			| 'crime'
			| 'rob_taken'
			| 'rob_lost'
			| 'slots_win'
			| 'slots_loss'
			| 'coinflip_win'
			| 'coinflip_loss'
			| 'blackjack_win'
			| 'blackjack_loss'
			| 'blackjack_tie'
			| 'deposit'
			| 'withdraw'
			| 'fish'
			| 'mine'
			| 'duel_win'
			| 'duel_loss'
			| 'admin_add'
			| 'admin_remove'
			| 'admin_reset'
			| 'weekly'
			| 'monthly'
			| 'roulette_win'
			| 'roulette_loss'
			| 'scratch_win'
			| 'scratch_loss'
			| 'loot_crate'
			| 'mega_crate'
			| 'jackpot_ticket'
			| 'scavenge'
			| 'gamble_win'
			| 'gamble_loss'
			| 'dice_win'
			| 'dice_loss'
			| 'rps_win'
			| 'rps_loss'
			| 'crash_win'
			| 'crash_loss'
			| 'horse_win'
			| 'horse_loss'
			| 'lottery_win'
			| 'lottery_loss'
			| 'mines_win'
			| 'mines_loss'
			| 'wheel_win'
			| 'wheel_loss'
			| 'highlow_win'
			| 'highlow_loss'
			| 'baccarat_win'
			| 'baccarat_loss'
			| 'poker_win'
			| 'poker_loss'
			| 'plinko_win'
			| 'plinko_loss'
			| 'keno_win'
			| 'keno_loss'
			| 'limbo_win'
			| 'limbo_loss'
			| 'war_win'
			| 'war_loss'
			| 'sicbo_win'
			| 'sicbo_loss'
			| 'tower_win'
			| 'tower_loss'
		>()
		.notNull(),
	amount: int('amount').notNull(),
	toUserId: varchar('to_user_id', { length: 64 }),
	note: text('note'),
	createdAt: datetime('created_at', { mode: 'date' }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ─── User Inventory ────────────────────────────────────────────────────────────

export const userInventory = mysqlTable(
	'user_inventory',
	{
		id: int('id').autoincrement().primaryKey(),
		guildId: varchar('guild_id', { length: 64 }).notNull(),
		userId: varchar('user_id', { length: 64 }).notNull(),
		itemId: int('item_id').notNull(),
		quantity: int('quantity').notNull().default(1),
		acquiredAt: datetime('acquired_at', { mode: 'date' }).notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(t) => [uniqueIndex('user_inventory_uniq').on(t.guildId, t.userId, t.itemId)],
);

// ─── Boost Settings ────────────────────────────────────────────────────────────

export const boostSettings = mysqlTable('boost_settings', {
	guildId: varchar('guild_id', { length: 64 }).primaryKey(),
	channelId: varchar('channel_id', { length: 64 }),
	message: text('message'),
	milestoneChannelId: varchar('milestone_channel_id', { length: 64 }),
	milestones: text('milestones').notNull().default('[]'), // JSON: number[]
});

// ─── Timed Roles ───────────────────────────────────────────────────────────────

export const timedRoles = mysqlTable('timed_roles', {
	id: int('id').autoincrement().primaryKey(),
	guildId: varchar('guild_id', { length: 64 }).notNull(),
	userId: varchar('user_id', { length: 64 }).notNull(),
	roleId: varchar('role_id', { length: 64 }).notNull(),
	expiresAt: datetime('expires_at', { mode: 'date' }).notNull(),
	done: boolean('done').notNull().default(false),
	grantedById: varchar('granted_by_id', { length: 64 }).notNull(),
	createdAt: datetime('created_at', { mode: 'date' }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ─── Auto Roles ────────────────────────────────────────────────────────────────

export const autoRoles = mysqlTable(
	'auto_roles',
	{
		id: int('id').autoincrement().primaryKey(),
		guildId: varchar('guild_id', { length: 64 }).notNull(),
		roleId: varchar('role_id', { length: 64 }).notNull(),
	},
	(t) => [uniqueIndex('auto_roles_uniq').on(t.guildId, t.roleId)],
);

// ─── Music Playlists ───────────────────────────────────────────────────────────

export type PlaylistTrack = { title: string; uri: string; author: string; duration: number };

export const musicPlaylists = mysqlTable(
	'music_playlists',
	{
		id: int('id').autoincrement().primaryKey(),
		userId: varchar('user_id', { length: 64 }).notNull(),
		guildId: varchar('guild_id', { length: 64 }),
		name: varchar('name', { length: 255 }).notNull(),
		tracks: text('tracks').notNull().default('[]'), // JSON: PlaylistTrack[]
		createdAt: datetime('created_at', { mode: 'date' }).notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(t) => [uniqueIndex('music_playlists_uniq').on(t.userId, t.name)],
);

// ─── Anti-Raid ────────────────────────────────────────────────────────────────

export const antiRaidSettings = mysqlTable('anti_raid_settings', {
	guildId: varchar('guild_id', { length: 64 }).primaryKey(),
	enabled: boolean('enabled').notNull().default(false),
	joinThreshold: int('join_threshold').notNull().default(10), // joins allowed per window
	windowSeconds: int('window_seconds').notNull().default(10),
	action: varchar('action', { length: 64 }).notNull().default('lock'), // 'lock' | 'kick' | 'ban'
	logChannelId: varchar('log_channel_id', { length: 64 }),
	alertRoleId: varchar('alert_role_id', { length: 64 }),
	autoUnlockMinutes: int('auto_unlock_minutes').notNull().default(10),
});

// ─── Music Queue Persistence ──────────────────────────────────────────────────

export type QueuedTrack = any;

export const musicQueues = mysqlTable('music_queues', {
	guildId: varchar('guild_id', { length: 64 }).primaryKey(),
	voiceChannelId: varchar('voice_channel_id', { length: 64 }).notNull(),
	textChannelId: varchar('text_channel_id', { length: 64 }).notNull(),
	volume: int('volume').notNull().default(100),
	tracks: text('tracks').notNull().default('[]'), // JSON: QueuedTrack[]
	position: int('position').notNull().default(0),
	paused: boolean('paused').notNull().default(false),
	savedAt: datetime('saved_at', { mode: 'date' }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ─── Social Feeds ─────────────────────────────────────────────────────────────

export type SocialPlatform = 'youtube' | 'reddit' | 'bluesky' | 'twitch' | 'tiktok' | 'rss';

export const socialFeeds = mysqlTable(
	'social_feeds',
	{
		id: int('id').autoincrement().primaryKey(),
		guildId: varchar('guild_id', { length: 64 }).notNull(),
		channelId: varchar('channel_id', { length: 64 }).notNull(),
		platform: varchar('platform', { length: 64 }).$type<SocialPlatform>().notNull(),
		handle: varchar('handle', { length: 255 }).notNull(), // normalised: YouTube channel ID, lowercase twitch user, etc.
		displayName: varchar('display_name', { length: 255 }).notNull(), // human-readable label shown in /feed list
		lastPostId: varchar('last_post_id', { length: 64 }),
		createdAt: datetime('created_at', { mode: 'date' }).notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(t) => [uniqueIndex('social_feeds_uniq').on(t.guildId, t.platform, t.handle)],
);

// ─── Honeypot Channels ────────────────────────────────────────────────────────

export type HoneypotPunishment = 'ban' | 'kick' | 'timeout' | 'warn';

export const honeypotChannels = mysqlTable('honeypot_channels', {
	guildId: varchar('guild_id', { length: 64 }).notNull(),
	channelId: varchar('channel_id', { length: 64 }).primaryKey(),
	punishment: varchar('punishment', { length: 64 }).$type<HoneypotPunishment>().notNull().default('ban'),
	duration: int('duration'), // Milliseconds
	messageId: varchar('message_id', { length: 64 }), // The warning message ID posted in that channel
	createdAt: datetime('created_at', { mode: 'date' }).notNull().default(sql`CURRENT_TIMESTAMP`),
});
