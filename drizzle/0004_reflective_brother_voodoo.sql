CREATE TABLE `highlights` (
	`id` int AUTO_INCREMENT NOT NULL,
	`guild_id` varchar(64) NOT NULL,
	`user_id` varchar(64) NOT NULL,
	`keyword` varchar(64) NOT NULL,
	CONSTRAINT `highlights_id` PRIMARY KEY(`id`),
	CONSTRAINT `highlights_uniq` UNIQUE(`guild_id`,`user_id`,`keyword`)
);
--> statement-breakpoint
CREATE TABLE `invite_joins` (
	`id` int AUTO_INCREMENT NOT NULL,
	`guild_id` varchar(64) NOT NULL,
	`user_id` varchar(64) NOT NULL,
	`inviter_id` varchar(64),
	`invite_code` varchar(64),
	`joined_at` bigint NOT NULL,
	`left_at` bigint,
	`fake` boolean NOT NULL DEFAULT false,
	CONSTRAINT `invite_joins_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `invite_rewards` (
	`id` int AUTO_INCREMENT NOT NULL,
	`guild_id` varchar(64) NOT NULL,
	`invites` int NOT NULL,
	`role_id` varchar(64) NOT NULL,
	CONSTRAINT `invite_rewards_id` PRIMARY KEY(`id`),
	CONSTRAINT `invite_rewards_uniq` UNIQUE(`guild_id`,`invites`,`role_id`)
);
--> statement-breakpoint
CREATE TABLE `level_multipliers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`guild_id` varchar(64) NOT NULL,
	`target_type` varchar(16) NOT NULL,
	`target_id` varchar(64) NOT NULL,
	`percent` int NOT NULL,
	CONSTRAINT `level_multipliers_id` PRIMARY KEY(`id`),
	CONSTRAINT `level_multipliers_uniq` UNIQUE(`guild_id`,`target_type`,`target_id`)
);
--> statement-breakpoint
CREATE TABLE `member_role_snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`guild_id` varchar(64) NOT NULL,
	`user_id` varchar(64) NOT NULL,
	`role_ids` text NOT NULL DEFAULT ('[]'),
	`nickname` varchar(64),
	`saved_at` bigint NOT NULL,
	CONSTRAINT `member_role_snapshots_id` PRIMARY KEY(`id`),
	CONSTRAINT `member_role_snapshots_guild_user_uniq` UNIQUE(`guild_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `role_persistence_settings` (
	`guild_id` varchar(64) NOT NULL,
	`ignored_role_ids` text NOT NULL DEFAULT ('[]'),
	`restore_nickname` boolean NOT NULL DEFAULT false,
	CONSTRAINT `role_persistence_settings_guild_id` PRIMARY KEY(`guild_id`)
);
--> statement-breakpoint
CREATE TABLE `scheduled_announcements` (
	`id` int AUTO_INCREMENT NOT NULL,
	`guild_id` varchar(64) NOT NULL,
	`channel_id` varchar(64) NOT NULL,
	`created_by` varchar(64) NOT NULL,
	`heading` varchar(256),
	`body` text NOT NULL,
	`color` varchar(32) NOT NULL DEFAULT 'blue',
	`ping_type` varchar(1),
	`ping_id` varchar(64),
	`next_run_at` bigint NOT NULL,
	`interval_ms` bigint,
	`active` boolean NOT NULL DEFAULT true,
	`last_sent_at` bigint,
	`created_at` bigint NOT NULL,
	CONSTRAINT `scheduled_announcements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `verification_settings` (
	`guild_id` varchar(64) NOT NULL,
	`role_id` varchar(64),
	`unverified_role_id` varchar(64),
	`captcha_enabled` boolean NOT NULL DEFAULT false,
	`min_account_age_days` int NOT NULL DEFAULT 0,
	`panel_channel_id` varchar(64),
	`panel_message_id` varchar(64),
	CONSTRAINT `verification_settings_guild_id` PRIMARY KEY(`guild_id`)
);
--> statement-breakpoint
ALTER TABLE `automod_settings` ADD `phishing_enabled` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `automod_settings` ADD `phishing_action` varchar(255) DEFAULT 'delete_timeout' NOT NULL;--> statement-breakpoint
ALTER TABLE `automod_settings` ADD `phishing_timeout_minutes` int DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE `global_modules` ADD `verification` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `global_modules` ADD `role_persistence` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `global_modules` ADD `invite_tracking` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `global_modules` ADD `highlights` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `guild_modules` ADD `verification` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `guild_modules` ADD `role_persistence` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `guild_modules` ADD `invite_tracking` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `guild_modules` ADD `highlights` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `level_settings` ADD `boost_percent` int DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE `level_settings` ADD `boost_ends_at` bigint;--> statement-breakpoint
CREATE INDEX `invite_joins_guild_inviter_idx` ON `invite_joins` (`guild_id`,`inviter_id`);--> statement-breakpoint
CREATE INDEX `invite_joins_guild_user_idx` ON `invite_joins` (`guild_id`,`user_id`);