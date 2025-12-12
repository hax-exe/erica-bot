import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import { guildsRouter } from './routes/guilds.js';
import { membersRouter } from './routes/members.js';
import { moderationRouter } from './routes/moderation.js';
import { statsRouter } from './routes/stats.js';
import type { ExtendedClient } from '../structures/Client.js';
import type { LeaderElectionService } from '../services/leaderElection.js';

const logger = createLogger('api');

// Extend Express Request to include our client
declare module 'express-serve-static-core' {
    interface Request {
        discordClient: ExtendedClient;
        userId?: string;
        guildId?: string;
    }
}

export function createApiServer(client: ExtendedClient, leaderElection?: LeaderElectionService): Express {
    const app = express();

    // Security middleware
    app.use(helmet());

    // CORS - only allow dashboard origin
    app.use(cors({
        origin: config.api.dashboardUrl,
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Secret', 'X-User-Id', 'X-Guild-Id'],
    }));

    // Parse JSON bodies
    app.use(express.json({ limit: '10kb' }));

    // Rate limiting
    const limiter = rateLimit({
        windowMs: 60 * 1000, // 1 minute
        max: 100, // 100 requests per minute
        message: { error: 'Too many requests, please try again later.' },
        standardHeaders: true,
        legacyHeaders: false,
    });
    app.use(limiter);

    // Attach Discord client to all requests
    app.use((req: Request, _res: Response, next: NextFunction) => {
        req.discordClient = client;
        next();
    });

    // API Secret authentication middleware
    app.use((req: Request, res: Response, next: NextFunction) => {
        const apiSecret = req.headers['x-api-secret'];

        // Skip auth for health check
        if (req.path === '/health') {
            return next();
        }

        // In development, allow requests without secret if not configured
        if (!config.api.secret && config.bot.isDev) {
            logger.warn('API running without secret in development mode');
            return next();
        }

        if (!apiSecret || apiSecret !== config.api.secret) {
            return res.status(401).json({ error: 'Invalid or missing API secret' });
        }

        // Extract user ID from header (set by dashboard after Discord OAuth)
        req.userId = req.headers['x-user-id'] as string;

        next();
    });

    // Health check endpoint
    app.get('/health', (_req: Request, res: Response) => {
        const haInfo = leaderElection ? {
            enabled: true,
            instanceId: leaderElection.id,
            isLeader: leaderElection.isLeader,
        } : {
            enabled: false,
        };

        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            guilds: client.guilds.cache.size,
            users: client.users.cache.size,
            music: {
                activePlayers: client.music.players.size,
            },
            ha: haInfo,
        });
    });

    // API routes
    app.use('/api/guilds', guildsRouter);
    app.use('/api/guilds', membersRouter);
    app.use('/api/guilds', moderationRouter);
    app.use('/api/guilds', statsRouter);

    // 404 handler
    app.use((_req: Request, res: Response) => {
        res.status(404).json({ error: 'Not found' });
    });

    // Error handler
    app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
        logger.error({ error: err }, 'API error');
        res.status(500).json({
            error: config.bot.isProd ? 'Internal server error' : err.message
        });
    });

    return app;
}

export function startApiServer(client: ExtendedClient, leaderElection?: LeaderElectionService): void {
    const app = createApiServer(client, leaderElection);
    const port = config.api.port;

    app.listen(port, () => {
        logger.info(`🌐 Bot API server running on port ${port}`);
    });
}
