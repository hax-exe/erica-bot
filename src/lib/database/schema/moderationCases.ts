import { pgTable, serial, text, integer, timestamp, unique } from 'drizzle-orm/pg-core';

export const moderationCases = pgTable(
  'moderation_cases',
  {
    id: serial('id').primaryKey(),
    guildId: text('guild_id').notNull(),
    caseNumber: integer('case_number').notNull(),
    type: text('type', { enum: ['warn', 'ban', 'kick', 'timeout'] }).notNull(),
    targetUserId: text('target_user_id').notNull(),
    moderatorId: text('moderator_id').notNull(),
    reason: text('reason'),
    duration: integer('duration'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique('moderation_cases_guild_case_unique').on(table.guildId, table.caseNumber)],
);
