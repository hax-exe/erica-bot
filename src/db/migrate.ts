import { sql } from 'drizzle-orm';
import { db } from './index.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('database-migrate');

/**
 * SQL statements to create all database tables.
 * Uses CREATE TABLE IF NOT EXISTS for idempotent execution.
 * These statements are derived from src/db/schema/index.ts
 */
const createTableStatements = [
    // Guilds table - base table that others reference
    `CREATE TABLE IF NOT EXISTS guilds (
        id VARCHAR(20) PRIMARY KEY,
        prefix VARCHAR(10) DEFAULT '!',
        language VARCHAR(10) DEFAULT 'en',
        moderation_enabled BOOLEAN DEFAULT true,
        music_enabled BOOLEAN DEFAULT true,
        leveling_enabled BOOLEAN DEFAULT true,
        economy_enabled BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
    )`,

    // Moderation settings
    `CREATE TABLE IF NOT EXISTS moderation_settings (
        guild_id VARCHAR(20) PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE,
        audit_log_channel_id VARCHAR(20),
        mod_log_channel_id VARCHAR(20),
        automod_enabled BOOLEAN DEFAULT false,
        anti_spam_enabled BOOLEAN DEFAULT false,
        anti_raid_enabled BOOLEAN DEFAULT false,
        warn_threshold INTEGER DEFAULT 3,
        warn_action VARCHAR(20) DEFAULT 'mute',
        banned_words JSONB DEFAULT '[]',
        allowed_invites JSONB DEFAULT '[]',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
    )`,

    // Leveling settings
    `CREATE TABLE IF NOT EXISTS leveling_settings (
        guild_id VARCHAR(20) PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE,
        xp_per_message INTEGER DEFAULT 15,
        xp_cooldown INTEGER DEFAULT 60,
        xp_multiplier INTEGER DEFAULT 100,
        announce_enabled BOOLEAN DEFAULT true,
        announce_channel_id VARCHAR(20),
        announce_message TEXT DEFAULT '🎉 Congratulations {user}! You reached level {level}!',
        ignored_channels JSONB DEFAULT '[]',
        ignored_roles JSONB DEFAULT '[]',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
    )`,

    // Economy settings
    `CREATE TABLE IF NOT EXISTS economy_settings (
        guild_id VARCHAR(20) PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE,
        currency_name VARCHAR(32) DEFAULT 'coins',
        currency_symbol VARCHAR(10) DEFAULT '🪙',
        daily_amount INTEGER DEFAULT 100,
        work_min_amount INTEGER DEFAULT 50,
        work_max_amount INTEGER DEFAULT 200,
        work_cooldown INTEGER DEFAULT 3600,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
    )`,

    // Music settings
    `CREATE TABLE IF NOT EXISTS music_settings (
        guild_id VARCHAR(20) PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE,
        default_volume INTEGER DEFAULT 50,
        max_queue_size INTEGER DEFAULT 100,
        dj_role_id VARCHAR(20),
        song_request_channel_id VARCHAR(20),
        vote_skip_enabled BOOLEAN DEFAULT true,
        vote_skip_percentage INTEGER DEFAULT 50,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
    )`,

    // Guild members - per-guild user data
    `CREATE TABLE IF NOT EXISTS guild_members (
        id SERIAL PRIMARY KEY,
        guild_id VARCHAR(20) NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
        user_id VARCHAR(20) NOT NULL,
        xp BIGINT DEFAULT 0,
        level INTEGER DEFAULT 0,
        total_messages BIGINT DEFAULT 0,
        last_xp_gain TIMESTAMP,
        balance BIGINT DEFAULT 0,
        bank BIGINT DEFAULT 0,
        last_daily TIMESTAMP,
        last_work TIMESTAMP,
        birthday TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
    )`,

    // Unique index for guild_members
    `CREATE UNIQUE INDEX IF NOT EXISTS guild_user_idx ON guild_members(guild_id, user_id)`,

    // Warnings
    `CREATE TABLE IF NOT EXISTS warnings (
        id SERIAL PRIMARY KEY,
        guild_id VARCHAR(20) NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
        user_id VARCHAR(20) NOT NULL,
        moderator_id VARCHAR(20) NOT NULL,
        reason TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
    )`,

    // Level rewards
    `CREATE TABLE IF NOT EXISTS level_rewards (
        id SERIAL PRIMARY KEY,
        guild_id VARCHAR(20) NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
        level INTEGER NOT NULL,
        role_id VARCHAR(20) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
    )`,

    // Auto responders
    `CREATE TABLE IF NOT EXISTS auto_responders (
        id SERIAL PRIMARY KEY,
        guild_id VARCHAR(20) NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
        name VARCHAR(64) NOT NULL,
        trigger TEXT NOT NULL,
        trigger_type VARCHAR(20) DEFAULT 'contains',
        response TEXT NOT NULL,
        embed_data JSONB,
        enabled BOOLEAN DEFAULT true,
        cooldown INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
    )`,

    // Custom commands
    `CREATE TABLE IF NOT EXISTS custom_commands (
        id SERIAL PRIMARY KEY,
        guild_id VARCHAR(20) NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
        name VARCHAR(32) NOT NULL,
        response TEXT NOT NULL,
        embed_data JSONB,
        enabled BOOLEAN DEFAULT true,
        usage_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
    )`,

    // Giveaways
    `CREATE TABLE IF NOT EXISTS giveaways (
        id SERIAL PRIMARY KEY,
        guild_id VARCHAR(20) NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
        channel_id VARCHAR(20) NOT NULL,
        message_id VARCHAR(20) NOT NULL,
        host_id VARCHAR(20) NOT NULL,
        prize TEXT NOT NULL,
        winners_count INTEGER DEFAULT 1,
        entries JSONB DEFAULT '[]',
        winners JSONB DEFAULT '[]',
        ends_at TIMESTAMP NOT NULL,
        ended BOOLEAN DEFAULT false,
        requirements JSONB,
        created_at TIMESTAMP DEFAULT NOW()
    )`,

    // Social feeds
    `CREATE TABLE IF NOT EXISTS social_feeds (
        id SERIAL PRIMARY KEY,
        guild_id VARCHAR(20) NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
        channel_id VARCHAR(20) NOT NULL,
        platform VARCHAR(20) NOT NULL,
        identifier VARCHAR(100) NOT NULL,
        custom_message TEXT,
        last_checked TIMESTAMP,
        last_post_id VARCHAR(100),
        enabled BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
    )`,

    // User playlists
    `CREATE TABLE IF NOT EXISTS playlists (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(20) NOT NULL,
        name VARCHAR(64) NOT NULL,
        tracks JSONB DEFAULT '[]',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
    )`,

    // Shop items
    `CREATE TABLE IF NOT EXISTS shop_items (
        id SERIAL PRIMARY KEY,
        guild_id VARCHAR(20) NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
        name VARCHAR(64) NOT NULL,
        description TEXT,
        price INTEGER NOT NULL,
        role_id VARCHAR(20),
        stock INTEGER,
        enabled BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
    )`,
];

/**
 * Push schema to database - creates all tables if they don't exist.
 * This is idempotent and safe to run on every startup.
 */
export async function pushSchema(): Promise<void> {
    logger.info('Checking database schema...');

    try {
        for (const statement of createTableStatements) {
            await db.execute(sql.raw(statement));
        }
        logger.info('✅ Database schema is ready');
    } catch (error) {
        logger.error({ error }, '❌ Failed to push database schema');
        throw error;
    }
}
