CREATE TABLE `active_spaces` (
	`channel_id` varchar(64) NOT NULL,
	`guild_id` varchar(64) NOT NULL,
	`owner_id` varchar(64) NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `active_spaces_channel_id` PRIMARY KEY(`channel_id`)
);
--> statement-breakpoint
CREATE TABLE `afk_statuses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` varchar(64) NOT NULL,
	`guild_id` varchar(64) NOT NULL,
	`reason` text NOT NULL DEFAULT ('AFK'),
	`set_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `afk_statuses_id` PRIMARY KEY(`id`),
	CONSTRAINT `afk_statuses_uniq` UNIQUE(`user_id`,`guild_id`)
);
--> statement-breakpoint
CREATE TABLE `anti_raid_settings` (
	`guild_id` varchar(64) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`join_threshold` int NOT NULL DEFAULT 10,
	`window_seconds` int NOT NULL DEFAULT 10,
	`action` varchar(64) NOT NULL DEFAULT 'lock',
	`log_channel_id` varchar(64),
	`alert_role_id` varchar(64),
	`auto_unlock_minutes` int NOT NULL DEFAULT 10,
	CONSTRAINT `anti_raid_settings_guild_id` PRIMARY KEY(`guild_id`)
);
--> statement-breakpoint
CREATE TABLE `auto_roles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`guild_id` varchar(64) NOT NULL,
	`role_id` varchar(64) NOT NULL,
	CONSTRAINT `auto_roles_id` PRIMARY KEY(`id`),
	CONSTRAINT `auto_roles_uniq` UNIQUE(`guild_id`,`role_id`)
);
--> statement-breakpoint
CREATE TABLE `automod_settings` (
	`guild_id` varchar(64) NOT NULL,
	`word_filter_enabled` boolean NOT NULL DEFAULT false,
	`word_filter_action` varchar(255) NOT NULL DEFAULT 'delete',
	`word_filter_timeout_minutes` int NOT NULL DEFAULT 5,
	`spam_enabled` boolean NOT NULL DEFAULT false,
	`spam_max_messages` int NOT NULL DEFAULT 5,
	`spam_window_seconds` int NOT NULL DEFAULT 5,
	`spam_action` varchar(255) NOT NULL DEFAULT 'delete_timeout',
	`spam_timeout_minutes` int NOT NULL DEFAULT 5,
	`caps_enabled` boolean NOT NULL DEFAULT false,
	`caps_percent` int NOT NULL DEFAULT 70,
	`caps_min_length` int NOT NULL DEFAULT 8,
	`caps_action` varchar(255) NOT NULL DEFAULT 'delete',
	`caps_timeout_minutes` int NOT NULL DEFAULT 5,
	`link_enabled` boolean NOT NULL DEFAULT false,
	`link_action` varchar(255) NOT NULL DEFAULT 'delete',
	`link_timeout_minutes` int NOT NULL DEFAULT 5,
	`link_whitelist` text NOT NULL DEFAULT ('[]'),
	`invite_enabled` boolean NOT NULL DEFAULT false,
	`invite_action` varchar(255) NOT NULL DEFAULT 'delete',
	`invite_timeout_minutes` int NOT NULL DEFAULT 5,
	`mention_enabled` boolean NOT NULL DEFAULT false,
	`mention_max` int NOT NULL DEFAULT 5,
	`mention_action` varchar(255) NOT NULL DEFAULT 'delete_warn',
	`mention_timeout_minutes` int NOT NULL DEFAULT 10,
	`new_account_enabled` boolean NOT NULL DEFAULT false,
	`new_account_age_days` int NOT NULL DEFAULT 7,
	`new_account_action` varchar(255) NOT NULL DEFAULT 'delete',
	`new_account_timeout_minutes` int NOT NULL DEFAULT 10,
	`exempt_roles` text NOT NULL DEFAULT ('[]'),
	`exempt_channels` text NOT NULL DEFAULT ('[]'),
	CONSTRAINT `automod_settings_guild_id` PRIMARY KEY(`guild_id`)
);
--> statement-breakpoint
CREATE TABLE `automod_word_filter` (
	`id` int AUTO_INCREMENT NOT NULL,
	`guild_id` varchar(64) NOT NULL,
	`word` varchar(255) NOT NULL,
	`is_regex` boolean NOT NULL DEFAULT false,
	`added_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `automod_word_filter_id` PRIMARY KEY(`id`),
	CONSTRAINT `automod_word_filter_uniq` UNIQUE(`guild_id`,`word`)
);
--> statement-breakpoint
CREATE TABLE `autoresponders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`guild_id` varchar(64) NOT NULL,
	`name` varchar(255) NOT NULL,
	`trigger` text NOT NULL,
	`match_mode` varchar(255) NOT NULL DEFAULT 'contains',
	`response` text NOT NULL,
	`enabled` boolean NOT NULL DEFAULT true,
	`cooldown_seconds` int NOT NULL DEFAULT 10,
	`channel_ids` text NOT NULL DEFAULT ('[]'),
	`reply_to_message` boolean NOT NULL DEFAULT true,
	`created_by` varchar(255) NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `autoresponders_id` PRIMARY KEY(`id`),
	CONSTRAINT `autoresponders_guild_name_uniq` UNIQUE(`guild_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `birthday_settings` (
	`guild_id` varchar(64) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`channel_id` varchar(64),
	`role_id` varchar(64),
	`message` text,
	CONSTRAINT `birthday_settings_guild_id` PRIMARY KEY(`guild_id`)
);
--> statement-breakpoint
CREATE TABLE `birthdays` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` varchar(64) NOT NULL,
	`guild_id` varchar(64) NOT NULL,
	`month` int NOT NULL,
	`day` int NOT NULL,
	`year` int,
	`last_wished` varchar(64),
	CONSTRAINT `birthdays_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `boost_settings` (
	`guild_id` varchar(64) NOT NULL,
	`channel_id` varchar(64),
	`message` text,
	`milestone_channel_id` varchar(64),
	`milestones` text NOT NULL DEFAULT ('[]'),
	CONSTRAINT `boost_settings_guild_id` PRIMARY KEY(`guild_id`)
);
--> statement-breakpoint
CREATE TABLE `bot_blacklist` (
	`user_id` varchar(64) NOT NULL,
	`reason` text NOT NULL DEFAULT ('No reason provided'),
	`added_by_id` varchar(64) NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `bot_blacklist_user_id` PRIMARY KEY(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `counting_settings` (
	`guild_id` varchar(64) NOT NULL,
	`channel_id` varchar(64),
	`current_count` int NOT NULL DEFAULT 0,
	`last_user_id` varchar(64),
	`high_score` int NOT NULL DEFAULT 0,
	`reset_on_fail` boolean NOT NULL DEFAULT true,
	`enabled` boolean NOT NULL DEFAULT false,
	CONSTRAINT `counting_settings_guild_id` PRIMARY KEY(`guild_id`)
);
--> statement-breakpoint
CREATE TABLE `economy` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` varchar(64) NOT NULL,
	`guild_id` varchar(64) NOT NULL,
	`balance` int NOT NULL DEFAULT 0,
	`bank` int NOT NULL DEFAULT 0,
	`bank_cap` int NOT NULL DEFAULT 5000,
	`daily_streak` int NOT NULL DEFAULT 0,
	`last_daily_at` datetime,
	`last_work_at` datetime,
	`last_crime_at` datetime,
	`last_rob_at` datetime,
	`padlock_expires_at` datetime,
	`work_boost_expires_at` datetime,
	`last_fish_at` datetime,
	`last_mine_at` datetime,
	CONSTRAINT `economy_id` PRIMARY KEY(`id`),
	CONSTRAINT `economy_guild_user_uniq` UNIQUE(`guild_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `economy_transactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`guild_id` varchar(64) NOT NULL,
	`user_id` varchar(64) NOT NULL,
	`type` varchar(64) NOT NULL,
	`amount` int NOT NULL,
	`to_user_id` varchar(64),
	`note` text,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `economy_transactions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `giveaways` (
	`id` int AUTO_INCREMENT NOT NULL,
	`guild_id` varchar(64) NOT NULL,
	`channel_id` varchar(64) NOT NULL,
	`message_id` varchar(64) NOT NULL,
	`prize` varchar(255) NOT NULL,
	`winner_count` int NOT NULL DEFAULT 1,
	`host_id` varchar(64) NOT NULL,
	`ends_at` datetime NOT NULL,
	`ended` boolean NOT NULL DEFAULT false,
	`winner_ids` text NOT NULL DEFAULT ('[]'),
	`entrant_ids` text NOT NULL DEFAULT ('[]'),
	`bonus_roles` text NOT NULL DEFAULT ('[]'),
	`required_role_id` varchar(64),
	`cancelled` boolean NOT NULL DEFAULT false,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `giveaways_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `global_modules` (
	`id` int NOT NULL,
	`leveling` boolean NOT NULL DEFAULT true,
	`welcomer` boolean NOT NULL DEFAULT true,
	`starboard` boolean NOT NULL DEFAULT true,
	`birthdays` boolean NOT NULL DEFAULT true,
	`spaces` boolean NOT NULL DEFAULT true,
	`sticky` boolean NOT NULL DEFAULT true,
	`tickets` boolean NOT NULL DEFAULT true,
	`tags` boolean NOT NULL DEFAULT true,
	`logging` boolean NOT NULL DEFAULT true,
	`music` boolean NOT NULL DEFAULT true,
	`reaction_roles` boolean NOT NULL DEFAULT true,
	`reports` boolean NOT NULL DEFAULT true,
	`reviews` boolean NOT NULL DEFAULT true,
	`verification` boolean NOT NULL DEFAULT true,
	`automod` boolean NOT NULL DEFAULT false,
	`suggestions` boolean NOT NULL DEFAULT true,
	`fun` boolean NOT NULL DEFAULT true,
	`giveaways` boolean NOT NULL DEFAULT true,
	`economy` boolean NOT NULL DEFAULT true,
	`tts` boolean NOT NULL DEFAULT true,
	`autoresponder` boolean NOT NULL DEFAULT true,
	CONSTRAINT `global_modules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `guild_modules` (
	`guild_id` varchar(64) NOT NULL,
	`leveling` boolean NOT NULL DEFAULT true,
	`welcomer` boolean NOT NULL DEFAULT true,
	`starboard` boolean NOT NULL DEFAULT true,
	`birthdays` boolean NOT NULL DEFAULT true,
	`spaces` boolean NOT NULL DEFAULT true,
	`sticky` boolean NOT NULL DEFAULT true,
	`tickets` boolean NOT NULL DEFAULT true,
	`tags` boolean NOT NULL DEFAULT true,
	`logging` boolean NOT NULL DEFAULT true,
	`music` boolean NOT NULL DEFAULT true,
	`reaction_roles` boolean NOT NULL DEFAULT true,
	`reports` boolean NOT NULL DEFAULT true,
	`reviews` boolean NOT NULL DEFAULT true,
	`verification` boolean NOT NULL DEFAULT true,
	`automod` boolean NOT NULL DEFAULT false,
	`suggestions` boolean NOT NULL DEFAULT true,
	`fun` boolean NOT NULL DEFAULT true,
	`giveaways` boolean NOT NULL DEFAULT true,
	`economy` boolean NOT NULL DEFAULT true,
	`tts` boolean NOT NULL DEFAULT true,
	`autoresponder` boolean NOT NULL DEFAULT true,
	CONSTRAINT `guild_modules_guild_id` PRIMARY KEY(`guild_id`)
);
--> statement-breakpoint
CREATE TABLE `guilds` (
	`id` varchar(64) NOT NULL,
	`log_webhook_url` text,
	`mod_log_webhook_url` text,
	`ticket_log_webhook_url` text,
	`report_webhook_url` text,
	`log_ignored_channel_ids` text NOT NULL DEFAULT ('[]'),
	`log_channel_id` varchar(64),
	`mod_log_channel_id` varchar(64),
	`ticket_log_channel_id` varchar(64),
	`report_channel_id` varchar(64),
	`tts_conflict_mode` varchar(64) NOT NULL DEFAULT 'block',
	`tts_role_id` varchar(64),
	`tts_default_language` varchar(64) NOT NULL DEFAULT 'en',
	`music_channel_id` varchar(64),
	`music_message_id` varchar(64),
	`max_volume_limit` int NOT NULL DEFAULT 100,
	`autoplay_source` varchar(64) NOT NULL DEFAULT 'spotify',
	`autoplay_enabled` boolean NOT NULL DEFAULT false,
	`warn_decay_days` int,
	`proof_required` boolean NOT NULL DEFAULT false,
	`require_review` boolean NOT NULL DEFAULT false,
	CONSTRAINT `guilds_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `honeypot_channels` (
	`guild_id` varchar(64) NOT NULL,
	`channel_id` varchar(64) NOT NULL,
	`punishment` varchar(64) NOT NULL DEFAULT 'ban',
	`duration` int,
	`message_id` varchar(64),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `honeypot_channels_channel_id` PRIMARY KEY(`channel_id`)
);
--> statement-breakpoint
CREATE TABLE `incidents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` text NOT NULL,
	`status` varchar(64) NOT NULL DEFAULT 'investigating',
	`severity` varchar(255) NOT NULL DEFAULT 'minor',
	`affected_service_ids` text NOT NULL DEFAULT ('[]'),
	`updates` text NOT NULL DEFAULT ('[]'),
	`started_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`resolved_at` datetime,
	`created_by_id` varchar(64) NOT NULL,
	CONSTRAINT `incidents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `infractions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`guild_id` varchar(64) NOT NULL,
	`user_id` varchar(64) NOT NULL,
	`moderator_id` varchar(64) NOT NULL,
	`type` varchar(64) NOT NULL,
	`reason` text NOT NULL DEFAULT ('No reason provided'),
	`duration` int,
	`case_id` varchar(64) NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`untimeout_logged` boolean NOT NULL DEFAULT false,
	`original_reason` text,
	`edited_at` datetime,
	`edited_by_id` varchar(64),
	`proof_url` text,
	`linked_case_id` varchar(64),
	CONSTRAINT `infractions_id` PRIMARY KEY(`id`),
	CONSTRAINT `infractions_case_id_uniq` UNIQUE(`case_id`)
);
--> statement-breakpoint
CREATE TABLE `leave_settings` (
	`guild_id` varchar(64) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`channel_id` varchar(64),
	`message` text,
	`title` text,
	`color` int,
	`footer` text,
	CONSTRAINT `leave_settings_guild_id` PRIMARY KEY(`guild_id`)
);
--> statement-breakpoint
CREATE TABLE `level_badges` (
	`id` int AUTO_INCREMENT NOT NULL,
	`guild_id` varchar(64) NOT NULL,
	`role_id` varchar(64) NOT NULL,
	`label` varchar(255) NOT NULL,
	`color` varchar(255) NOT NULL DEFAULT '#5865F2',
	`emoji` varchar(64),
	`priority` int NOT NULL DEFAULT 0,
	CONSTRAINT `level_badges_id` PRIMARY KEY(`id`),
	CONSTRAINT `level_badges_guild_role_uniq` UNIQUE(`guild_id`,`role_id`)
);
--> statement-breakpoint
CREATE TABLE `level_roles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`guild_id` varchar(64) NOT NULL,
	`level` int NOT NULL,
	`role_id` varchar(64) NOT NULL,
	CONSTRAINT `level_roles_id` PRIMARY KEY(`id`),
	CONSTRAINT `level_roles_uniq` UNIQUE(`guild_id`,`level`,`role_id`)
);
--> statement-breakpoint
CREATE TABLE `level_settings` (
	`guild_id` varchar(64) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT true,
	`xp_min` int NOT NULL DEFAULT 15,
	`xp_max` int NOT NULL DEFAULT 25,
	`cooldown_seconds` int NOT NULL DEFAULT 60,
	`level_up_channel_id` varchar(64),
	`level_up_message` text NOT NULL DEFAULT ('🎉 {mention} leveled up to **level {level}**!'),
	`no_xp_role_ids` text NOT NULL DEFAULT ('[]'),
	`no_xp_channel_ids` text NOT NULL DEFAULT ('[]'),
	`voice_xp_enabled` boolean NOT NULL DEFAULT true,
	`voice_xp_per_minute` int NOT NULL DEFAULT 3,
	`voice_min_members` int NOT NULL DEFAULT 1,
	`no_xp_voice_channel_ids` text NOT NULL DEFAULT ('[]'),
	CONSTRAINT `level_settings_guild_id` PRIMARY KEY(`guild_id`)
);
--> statement-breakpoint
CREATE TABLE `maintenance_state` (
	`id` int NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`reason` text,
	`updates` text NOT NULL DEFAULT ('[]'),
	`started_at` datetime,
	CONSTRAINT `maintenance_state_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `minecraft_links` (
	`user_id` varchar(64) NOT NULL,
	`minecraft_name` varchar(255) NOT NULL,
	`minecraft_uuid` varchar(64),
	`linked_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `minecraft_links_user_id` PRIMARY KEY(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `mod_notes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`guild_id` varchar(64) NOT NULL,
	`user_id` varchar(64) NOT NULL,
	`moderator_id` varchar(64) NOT NULL,
	`content` text NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `mod_notes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `moderation_presets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`guild_id` varchar(64) NOT NULL,
	`reason` text NOT NULL,
	CONSTRAINT `moderation_presets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `music_playlists` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` varchar(64) NOT NULL,
	`guild_id` varchar(64),
	`name` varchar(255) NOT NULL,
	`tracks` text NOT NULL DEFAULT ('[]'),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `music_playlists_id` PRIMARY KEY(`id`),
	CONSTRAINT `music_playlists_uniq` UNIQUE(`user_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `music_queues` (
	`guild_id` varchar(64) NOT NULL,
	`voice_channel_id` varchar(64) NOT NULL,
	`text_channel_id` varchar(64) NOT NULL,
	`volume` int NOT NULL DEFAULT 100,
	`tracks` text NOT NULL DEFAULT ('[]'),
	`position` int NOT NULL DEFAULT 0,
	`paused` boolean NOT NULL DEFAULT false,
	`saved_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `music_queues_guild_id` PRIMARY KEY(`guild_id`)
);
--> statement-breakpoint
CREATE TABLE `pending_verifications` (
	`user_id` varchar(64) NOT NULL,
	`guild_id` varchar(64) NOT NULL,
	`code` varchar(64) NOT NULL,
	`expires_at` datetime NOT NULL,
	CONSTRAINT `pending_verifications_user_id` PRIMARY KEY(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `preset_badge_roles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`preset` varchar(64) NOT NULL,
	`role_id` varchar(64) NOT NULL,
	`emoji` varchar(64),
	CONSTRAINT `preset_badge_roles_id` PRIMARY KEY(`id`),
	CONSTRAINT `preset_badge_roles_uniq` UNIQUE(`preset`)
);
--> statement-breakpoint
CREATE TABLE `reminders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` varchar(64) NOT NULL,
	`channel_id` varchar(64) NOT NULL,
	`guild_id` varchar(64),
	`content` text NOT NULL,
	`remind_at` datetime NOT NULL,
	`interval_ms` int,
	`done` boolean NOT NULL DEFAULT false,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `reminders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `review_settings` (
	`guild_id` varchar(64) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`channel_id` varchar(64),
	CONSTRAINT `review_settings_guild_id` PRIMARY KEY(`guild_id`)
);
--> statement-breakpoint
CREATE TABLE `rr_panel_roles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`panel_id` int NOT NULL,
	`role_id` varchar(64) NOT NULL,
	`label` varchar(255) NOT NULL,
	`description` text,
	`emoji` varchar(64),
	CONSTRAINT `rr_panel_roles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `rr_panels` (
	`id` int AUTO_INCREMENT NOT NULL,
	`guild_id` varchar(64) NOT NULL,
	`channel_id` varchar(64) NOT NULL,
	`message_id` varchar(64) NOT NULL,
	`title` text NOT NULL DEFAULT ('Role Selection'),
	`description` text,
	`mode` varchar(64) NOT NULL DEFAULT 'select',
	CONSTRAINT `rr_panels_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `service_overrides` (
	`service_id` varchar(64) NOT NULL,
	`status` varchar(64) NOT NULL,
	`reason` text,
	`updates` text NOT NULL DEFAULT ('[]'),
	`set_by_id` varchar(64) NOT NULL,
	`set_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `service_overrides_service_id` PRIMARY KEY(`service_id`)
);
--> statement-breakpoint
CREATE TABLE `shop_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`guild_id` varchar(64) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`cost` int NOT NULL,
	`role_id` varchar(64),
	`type` varchar(64) NOT NULL DEFAULT 'role',
	`item_key` varchar(64),
	`duration_hours` int,
	CONSTRAINT `shop_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `shop_items_uniq` UNIQUE(`guild_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `social_feeds` (
	`id` int AUTO_INCREMENT NOT NULL,
	`guild_id` varchar(64) NOT NULL,
	`channel_id` varchar(64) NOT NULL,
	`platform` varchar(64) NOT NULL,
	`handle` varchar(255) NOT NULL,
	`display_name` varchar(255) NOT NULL,
	`last_post_id` varchar(64),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `social_feeds_id` PRIMARY KEY(`id`),
	CONSTRAINT `social_feeds_uniq` UNIQUE(`guild_id`,`platform`,`handle`)
);
--> statement-breakpoint
CREATE TABLE `space_settings` (
	`guild_id` varchar(64) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`trigger_channel_id` varchar(64),
	`category_id` varchar(64),
	`user_limit` int NOT NULL DEFAULT 0,
	`name_template` text,
	CONSTRAINT `space_settings_guild_id` PRIMARY KEY(`guild_id`)
);
--> statement-breakpoint
CREATE TABLE `starboard_entries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`guild_id` varchar(64) NOT NULL,
	`source_message_id` varchar(64) NOT NULL,
	`starboard_message_id` varchar(64) NOT NULL,
	`author_id` varchar(64) NOT NULL,
	`channel_id` varchar(64) NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `starboard_entries_id` PRIMARY KEY(`id`),
	CONSTRAINT `starboard_entries_source_message_id_unique` UNIQUE(`source_message_id`)
);
--> statement-breakpoint
CREATE TABLE `starboard_settings` (
	`guild_id` varchar(64) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`channel_id` varchar(64),
	`emoji` varchar(64) NOT NULL DEFAULT '⭐',
	`threshold` int NOT NULL DEFAULT 3,
	CONSTRAINT `starboard_settings_guild_id` PRIMARY KEY(`guild_id`)
);
--> statement-breakpoint
CREATE TABLE `stats_channels` (
	`guild_id` varchar(64) NOT NULL,
	`member_count_channel_id` varchar(64),
	`online_count_channel_id` varchar(64),
	`bot_count_channel_id` varchar(64),
	`channel_count_channel_id` varchar(64),
	CONSTRAINT `stats_channels_guild_id` PRIMARY KEY(`guild_id`)
);
--> statement-breakpoint
CREATE TABLE `status_checks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`service_id` varchar(64) NOT NULL,
	`online` boolean NOT NULL,
	`ping_ms` int,
	`checked_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `status_checks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `status_panel` (
	`id` int NOT NULL,
	`channel_id` varchar(64) NOT NULL,
	`message_id` varchar(64) NOT NULL,
	`guild_id` varchar(64) NOT NULL,
	CONSTRAINT `status_panel_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `status_subscribers` (
	`user_id` varchar(64) NOT NULL,
	`subscribed_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `status_subscribers_user_id` PRIMARY KEY(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `sticky_messages` (
	`channel_id` varchar(64) NOT NULL,
	`guild_id` varchar(64) NOT NULL,
	`content` text NOT NULL,
	`last_message_id` varchar(64),
	`enabled` boolean NOT NULL DEFAULT true,
	`expires_at` datetime,
	CONSTRAINT `sticky_messages_channel_id` PRIMARY KEY(`channel_id`)
);
--> statement-breakpoint
CREATE TABLE `suggestion_settings` (
	`guild_id` varchar(64) NOT NULL,
	`channel_id` varchar(64),
	`dm_on_update` boolean NOT NULL DEFAULT true,
	CONSTRAINT `suggestion_settings_guild_id` PRIMARY KEY(`guild_id`)
);
--> statement-breakpoint
CREATE TABLE `suggestion_votes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`suggestion_id` int NOT NULL,
	`user_id` varchar(64) NOT NULL,
	`vote` varchar(255) NOT NULL,
	CONSTRAINT `suggestion_votes_id` PRIMARY KEY(`id`),
	CONSTRAINT `suggestion_votes_uniq` UNIQUE(`suggestion_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `suggestions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`guild_id` varchar(64) NOT NULL,
	`user_id` varchar(64) NOT NULL,
	`channel_id` varchar(64) NOT NULL,
	`message_id` varchar(64) NOT NULL,
	`content` text NOT NULL,
	`status` varchar(64) NOT NULL DEFAULT 'pending',
	`reviewed_by_id` varchar(64),
	`review_reason` text,
	`upvotes` int NOT NULL DEFAULT 0,
	`downvotes` int NOT NULL DEFAULT 0,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `suggestions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `support_blacklist` (
	`id` int AUTO_INCREMENT NOT NULL,
	`guild_id` varchar(64) NOT NULL,
	`user_id` varchar(64) NOT NULL,
	`reason` text NOT NULL DEFAULT ('No reason provided'),
	`added_by_id` varchar(64) NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `support_blacklist_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` int AUTO_INCREMENT NOT NULL,
	`guild_id` varchar(64) NOT NULL,
	`name` varchar(255) NOT NULL,
	`aliases` text NOT NULL DEFAULT ('[]'),
	`content` text,
	`embed` text,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `tags_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tempbans` (
	`id` int AUTO_INCREMENT NOT NULL,
	`guild_id` varchar(64) NOT NULL,
	`user_id` varchar(64) NOT NULL,
	`expires_at` datetime NOT NULL,
	`case_id` varchar(64) NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `tempbans_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ticket_reviews` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ticket_id` int NOT NULL,
	`guild_id` varchar(64) NOT NULL,
	`user_id` varchar(64) NOT NULL,
	`rating` int NOT NULL,
	`comment` text,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `ticket_reviews_id` PRIMARY KEY(`id`),
	CONSTRAINT `ticket_reviews_ticket_id_unique` UNIQUE(`ticket_id`)
);
--> statement-breakpoint
CREATE TABLE `tickets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`guild_id` varchar(64) NOT NULL,
	`user_id` varchar(64) NOT NULL,
	`channel_id` varchar(64) NOT NULL,
	`category_id` varchar(64) NOT NULL,
	`status` varchar(64) NOT NULL DEFAULT 'open',
	`transcript_code` varchar(64),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`closed_at` datetime,
	`closed_by_id` varchar(64),
	`claimed_by_id` varchar(64),
	`last_activity_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`inactivity_warning_sent` boolean NOT NULL DEFAULT false,
	CONSTRAINT `tickets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `timed_roles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`guild_id` varchar(64) NOT NULL,
	`user_id` varchar(64) NOT NULL,
	`role_id` varchar(64) NOT NULL,
	`expires_at` datetime NOT NULL,
	`done` boolean NOT NULL DEFAULT false,
	`granted_by_id` varchar(64) NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `timed_roles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `trivia_scores` (
	`id` int AUTO_INCREMENT NOT NULL,
	`guild_id` varchar(64) NOT NULL,
	`user_id` varchar(64) NOT NULL,
	`wins` int NOT NULL DEFAULT 0,
	`total` int NOT NULL DEFAULT 0,
	CONSTRAINT `trivia_scores_id` PRIMARY KEY(`id`),
	CONSTRAINT `trivia_scores_uniq` UNIQUE(`guild_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `user_inventory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`guild_id` varchar(64) NOT NULL,
	`user_id` varchar(64) NOT NULL,
	`item_id` int NOT NULL,
	`quantity` int NOT NULL DEFAULT 1,
	`acquired_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `user_inventory_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_inventory_uniq` UNIQUE(`guild_id`,`user_id`,`item_id`)
);
--> statement-breakpoint
CREATE TABLE `warn_escalation` (
	`id` int AUTO_INCREMENT NOT NULL,
	`guild_id` varchar(64) NOT NULL,
	`threshold` int NOT NULL,
	`action` varchar(64) NOT NULL,
	`duration_ms` int,
	CONSTRAINT `warn_escalation_id` PRIMARY KEY(`id`),
	CONSTRAINT `warn_escalation_uniq` UNIQUE(`guild_id`,`threshold`)
);
--> statement-breakpoint
CREATE TABLE `welcome_settings` (
	`guild_id` varchar(64) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`channel_id` varchar(64),
	`message` text,
	`title` text,
	`color` int,
	`footer` text,
	`show_avatar` boolean NOT NULL DEFAULT true,
	`autorole_id` varchar(64),
	`dm_enabled` boolean NOT NULL DEFAULT false,
	`dm_message` text,
	CONSTRAINT `welcome_settings_guild_id` PRIMARY KEY(`guild_id`)
);
--> statement-breakpoint
CREATE TABLE `xp` (
	`id` int AUTO_INCREMENT NOT NULL,
	`guild_id` varchar(64) NOT NULL,
	`user_id` varchar(64) NOT NULL,
	`total_xp` int NOT NULL DEFAULT 0,
	`level` int NOT NULL DEFAULT 0,
	`last_message_at` int,
	`accent_color` varchar(64),
	`background_type` varchar(64) NOT NULL DEFAULT 'color',
	`background_value` varchar(64),
	CONSTRAINT `xp_id` PRIMARY KEY(`id`),
	CONSTRAINT `xp_guild_user_uniq` UNIQUE(`guild_id`,`user_id`)
);
