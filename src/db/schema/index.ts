import {
    pgTable,
    varchar,
    boolean,
    integer,
    timestamp,
    jsonb,
    text,
    bigint,
    serial,
    primaryKey,
    uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ============================================
// Guild Configuration
// ============================================

export const guilds = pgTable('guilds', {
    id: varchar('id', { length: 20 }).primaryKey(), // Discord snowflake
    prefix: varchar('prefix', { length: 10 }).default('!'),
    language: varchar('language', { length: 10 }).default('en'),

    // Module toggles
    moderationEnabled: boolean('moderation_enabled').default(true),
    musicEnabled: boolean('music_enabled').default(true),
    levelingEnabled: boolean('leveling_enabled').default(true),
    economyEnabled: boolean('economy_enabled').default(true),

    // Timestamps
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

// ============================================
// Moderation Settings
// ============================================

export const moderationSettings = pgTable('moderation_settings', {
    guildId: varchar('guild_id', { length: 20 }).primaryKey().references(() => guilds.id, { onDelete: 'cascade' }),

    // Logging
    auditLogChannelId: varchar('audit_log_channel_id', { length: 20 }),
    modLogChannelId: varchar('mod_log_channel_id', { length: 20 }),

    // Auto-mod settings
    autoModEnabled: boolean('automod_enabled').default(false),
    antiSpamEnabled: boolean('anti_spam_enabled').default(false),
    antiRaidEnabled: boolean('anti_raid_enabled').default(false),

    // Thresholds
    warnThreshold: integer('warn_threshold').default(3),
    warnAction: varchar('warn_action', { length: 20 }).default('mute'), // mute, kick, ban

    // Filters
    bannedWords: jsonb('banned_words').$type<string[]>().default([]),
    allowedInvites: jsonb('allowed_invites').$type<string[]>().default([]),

    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

// ============================================
// Leveling Settings
// ============================================

export const levelingSettings = pgTable('leveling_settings', {
    guildId: varchar('guild_id', { length: 20 }).primaryKey().references(() => guilds.id, { onDelete: 'cascade' }),

    // XP Configuration
    xpPerMessage: integer('xp_per_message').default(15),
    xpCooldown: integer('xp_cooldown').default(60), // seconds
    xpMultiplier: integer('xp_multiplier').default(100), // percentage (100 = 1x)

    // Announcements
    announceEnabled: boolean('announce_enabled').default(true),
    announceChannelId: varchar('announce_channel_id', { length: 20 }),
    announceMessage: text('announce_message').default('🎉 Congratulations {user}! You reached level {level}!'),

    // Ignored channels/roles
    ignoredChannels: jsonb('ignored_channels').$type<string[]>().default([]),
    ignoredRoles: jsonb('ignored_roles').$type<string[]>().default([]),

    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

// ============================================
// Economy Settings
// ============================================

export const economySettings = pgTable('economy_settings', {
    guildId: varchar('guild_id', { length: 20 }).primaryKey().references(() => guilds.id, { onDelete: 'cascade' }),

    currencyName: varchar('currency_name', { length: 32 }).default('coins'),
    currencySymbol: varchar('currency_symbol', { length: 10 }).default('🪙'),

    dailyAmount: integer('daily_amount').default(100),
    workMinAmount: integer('work_min_amount').default(50),
    workMaxAmount: integer('work_max_amount').default(200),
    workCooldown: integer('work_cooldown').default(3600), // seconds

    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

// ============================================
// Music Settings
// ============================================

export const musicSettings = pgTable('music_settings', {
    guildId: varchar('guild_id', { length: 20 }).primaryKey().references(() => guilds.id, { onDelete: 'cascade' }),

    defaultVolume: integer('default_volume').default(50),
    maxQueueSize: integer('max_queue_size').default(100),
    djRoleId: varchar('dj_role_id', { length: 20 }),
    songRequestChannelId: varchar('song_request_channel_id', { length: 20 }),
    voteSkipEnabled: boolean('vote_skip_enabled').default(true),
    voteSkipPercentage: integer('vote_skip_percentage').default(50),

    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

// ============================================
// Guild Members (Per-guild user data)
// ============================================

export const guildMembers = pgTable('guild_members', {
    id: serial('id').primaryKey(),
    guildId: varchar('guild_id', { length: 20 }).notNull().references(() => guilds.id, { onDelete: 'cascade' }),
    odId: varchar('user_id', { length: 20 }).notNull(),

    // Leveling
    xp: bigint('xp', { mode: 'number' }).default(0),
    level: integer('level').default(0),
    totalMessages: bigint('total_messages', { mode: 'number' }).default(0),
    lastXpGain: timestamp('last_xp_gain'),

    // Economy
    balance: bigint('balance', { mode: 'number' }).default(0),
    bank: bigint('bank', { mode: 'number' }).default(0),
    lastDaily: timestamp('last_daily'),
    lastWork: timestamp('last_work'),

    // Profile
    birthday: timestamp('birthday'),

    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
    // Unique constraint on guild + user combination
    guildUserUnique: uniqueIndex('guild_user_idx').on(table.guildId, table.odId),
}));

// ============================================
// Warnings
// ============================================

export const warnings = pgTable('warnings', {
    id: serial('id').primaryKey(),
    guildId: varchar('guild_id', { length: 20 }).notNull().references(() => guilds.id, { onDelete: 'cascade' }),
    userId: varchar('user_id', { length: 20 }).notNull(),
    moderatorId: varchar('moderator_id', { length: 20 }).notNull(),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
});

// ============================================
// Level Role Rewards
// ============================================

export const levelRewards = pgTable('level_rewards', {
    id: serial('id').primaryKey(),
    guildId: varchar('guild_id', { length: 20 }).notNull().references(() => guilds.id, { onDelete: 'cascade' }),
    level: integer('level').notNull(),
    roleId: varchar('role_id', { length: 20 }).notNull(),
    createdAt: timestamp('created_at').defaultNow(),
});

// ============================================
// Auto Responders
// ============================================

export const autoResponders = pgTable('auto_responders', {
    id: serial('id').primaryKey(),
    guildId: varchar('guild_id', { length: 20 }).notNull().references(() => guilds.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 64 }).notNull(),
    trigger: text('trigger').notNull(),
    triggerType: varchar('trigger_type', { length: 20 }).default('contains'), // exact, contains, regex, startswith
    response: text('response').notNull(),
    embedData: jsonb('embed_data'),
    enabled: boolean('enabled').default(true),
    cooldown: integer('cooldown').default(0),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

// ============================================
// Custom Commands
// ============================================

export const customCommands = pgTable('custom_commands', {
    id: serial('id').primaryKey(),
    guildId: varchar('guild_id', { length: 20 }).notNull().references(() => guilds.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 32 }).notNull(),
    response: text('response').notNull(),
    embedData: jsonb('embed_data'),
    enabled: boolean('enabled').default(true),
    usageCount: integer('usage_count').default(0),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

// ============================================
// Giveaways
// ============================================

export const giveaways = pgTable('giveaways', {
    id: serial('id').primaryKey(),
    guildId: varchar('guild_id', { length: 20 }).notNull().references(() => guilds.id, { onDelete: 'cascade' }),
    channelId: varchar('channel_id', { length: 20 }).notNull(),
    messageId: varchar('message_id', { length: 20 }).notNull(),
    hostId: varchar('host_id', { length: 20 }).notNull(),
    prize: text('prize').notNull(),
    winnersCount: integer('winners_count').default(1),
    entries: jsonb('entries').$type<string[]>().default([]),
    winners: jsonb('winners').$type<string[]>().default([]),
    endsAt: timestamp('ends_at').notNull(),
    ended: boolean('ended').default(false),
    requirements: jsonb('requirements').$type<{
        roleId?: string;
        minLevel?: number;
        minMessages?: number;
    }>(),
    createdAt: timestamp('created_at').defaultNow(),
});

// ============================================
// Social Feeds
// ============================================

export const socialFeeds = pgTable('social_feeds', {
    id: serial('id').primaryKey(),
    guildId: varchar('guild_id', { length: 20 }).notNull().references(() => guilds.id, { onDelete: 'cascade' }),
    channelId: varchar('channel_id', { length: 20 }).notNull(),
    platform: varchar('platform', { length: 20 }).notNull(), // twitch, youtube, reddit
    identifier: varchar('identifier', { length: 100 }).notNull(), // channel name, subreddit, etc.
    customMessage: text('custom_message'),
    lastChecked: timestamp('last_checked'),
    lastPostId: varchar('last_post_id', { length: 100 }),
    enabled: boolean('enabled').default(true),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

// ============================================
// User Playlists
// ============================================

export const playlists = pgTable('playlists', {
    id: serial('id').primaryKey(),
    userId: varchar('user_id', { length: 20 }).notNull(),
    name: varchar('name', { length: 64 }).notNull(),
    tracks: jsonb('tracks').$type<{
        title: string;
        author: string;
        uri: string;
        duration: number;
    }[]>().default([]),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

// ============================================
// Shop Items
// ============================================

export const shopItems = pgTable('shop_items', {
    id: serial('id').primaryKey(),
    guildId: varchar('guild_id', { length: 20 }).notNull().references(() => guilds.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 64 }).notNull(),
    description: text('description'),
    price: integer('price').notNull(),
    roleId: varchar('role_id', { length: 20 }), // If it grants a role
    stock: integer('stock'), // null = unlimited
    enabled: boolean('enabled').default(true),
    createdAt: timestamp('created_at').defaultNow(),
});

// ============================================
// Relations
// ============================================

export const guildsRelations = relations(guilds, ({ one, many }) => ({
    moderationSettings: one(moderationSettings),
    levelingSettings: one(levelingSettings),
    economySettings: one(economySettings),
    musicSettings: one(musicSettings),
    members: many(guildMembers),
    warnings: many(warnings),
    levelRewards: many(levelRewards),
    autoResponders: many(autoResponders),
    customCommands: many(customCommands),
    giveaways: many(giveaways),
    socialFeeds: many(socialFeeds),
    shopItems: many(shopItems),
}));
