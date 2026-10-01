ALTER TABLE `honeypot_channels` MODIFY COLUMN `duration` bigint;--> statement-breakpoint
ALTER TABLE `infractions` MODIFY COLUMN `duration` bigint;--> statement-breakpoint
ALTER TABLE `reminders` MODIFY COLUMN `interval_ms` bigint;--> statement-breakpoint
ALTER TABLE `social_feeds` MODIFY COLUMN `last_post_id` varchar(512);--> statement-breakpoint
ALTER TABLE `warn_escalation` MODIFY COLUMN `duration_ms` bigint;--> statement-breakpoint
ALTER TABLE `xp` MODIFY COLUMN `last_message_at` bigint;--> statement-breakpoint
ALTER TABLE `xp` MODIFY COLUMN `background_value` varchar(512);