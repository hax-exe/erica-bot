import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
    // Discord
    DISCORD_TOKEN: z.string().min(1, 'Discord token is required'),
    DISCORD_CLIENT_ID: z.string().min(1, 'Discord client ID is required'),
    DISCORD_DEV_GUILD_ID: z.string().optional(),

    // Database
    DATABASE_URL: z.string().url('Invalid database URL'),

    // Lavalink
    LAVALINK_HOST: z.string().default('localhost'),
    LAVALINK_PORT: z.string().default('2333').transform(Number),
    LAVALINK_PASSWORD: z.string().min(1, 'Lavalink password is required'),

    // Bot API
    BOT_API_PORT: z.string().default('3002').transform(Number),
    BOT_API_SECRET: z.string().min(32, 'API secret must be at least 32 characters').optional(),
    DASHBOARD_URL: z.string().url().default('http://localhost:3000'),

    // Bot
    BOT_PREFIX: z.string().default('!'),
    BOT_DEFAULT_LANGUAGE: z.string().default('en'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

    // Logging
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    // Optional API Keys
    SPOTIFY_CLIENT_ID: z.string().optional(),
    SPOTIFY_CLIENT_SECRET: z.string().optional(),
    YOUTUBE_OAUTH_REFRESH_TOKEN: z.string().optional(),
    TWITCH_CLIENT_ID: z.string().optional(),
    TWITCH_CLIENT_SECRET: z.string().optional(),
    GENIUS_ACCESS_TOKEN: z.string().optional(),

    // Redis
    REDIS_URL: z.string().default('redis://localhost:6379'),
});

function validateEnv() {
    const result = envSchema.safeParse(process.env);

    if (!result.success) {
        console.error('❌ Invalid environment variables:');
        console.error(result.error.format());
        process.exit(1);
    }

    return result.data;
}

export const env = validateEnv();

export const config = {
    discord: {
        token: env.DISCORD_TOKEN,
        clientId: env.DISCORD_CLIENT_ID,
        devGuildId: env.DISCORD_DEV_GUILD_ID,
    },
    database: {
        url: env.DATABASE_URL,
    },
    lavalink: {
        host: env.LAVALINK_HOST,
        port: env.LAVALINK_PORT,
        password: env.LAVALINK_PASSWORD,
    },
    api: {
        port: env.BOT_API_PORT,
        secret: env.BOT_API_SECRET,
        dashboardUrl: env.DASHBOARD_URL,
    },
    bot: {
        prefix: env.BOT_PREFIX,
        defaultLanguage: env.BOT_DEFAULT_LANGUAGE,
        isDev: env.NODE_ENV === 'development',
        isProd: env.NODE_ENV === 'production',
    },
    logging: {
        level: env.LOG_LEVEL,
    },
    apis: {
        spotify: {
            clientId: env.SPOTIFY_CLIENT_ID,
            clientSecret: env.SPOTIFY_CLIENT_SECRET,
        },
        youtube: {
            refreshToken: env.YOUTUBE_OAUTH_REFRESH_TOKEN,
        },
        twitch: {
            clientId: env.TWITCH_CLIENT_ID,
            clientSecret: env.TWITCH_CLIENT_SECRET,
        },
        genius: {
            accessToken: env.GENIUS_ACCESS_TOKEN,
        },
    },
    redis: {
        url: env.REDIS_URL,
    },
} as const;

export type Config = typeof config;
