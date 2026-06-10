import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const guilds = pgTable('guilds', {
  id: text('id').primaryKey(),
  modLogChannelId: text('mod_log_channel_id'),
  modRoleId: text('mod_role_id'),
  locale: text('locale').default('en-US').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});
