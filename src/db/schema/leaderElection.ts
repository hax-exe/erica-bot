import {
    pgTable,
    varchar,
    boolean,
    timestamp,
    jsonb,
} from 'drizzle-orm/pg-core';

// ============================================
// Bot Instances (for HA tracking)
// ============================================

export const botInstances = pgTable('bot_instances', {
    id: varchar('id', { length: 64 }).primaryKey(), // Unique instance ID
    isLeader: boolean('is_leader').default(false),
    lastHeartbeat: timestamp('last_heartbeat').notNull(),
    startedAt: timestamp('started_at').defaultNow(),
    stoppedAt: timestamp('stopped_at'),
    metadata: jsonb('metadata').$type<{
        hostname: string;
        pid: number;
        version: string;
        nodeEnv: string;
    }>(),
});
