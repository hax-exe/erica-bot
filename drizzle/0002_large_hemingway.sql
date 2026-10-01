ALTER TABLE `global_modules` MODIFY COLUMN `automod` boolean NOT NULL DEFAULT true;--> statement-breakpoint
-- AutoMod used to run on every message regardless of the module toggles (an unconditional
-- listener, now removed). Keep it running wherever it was effectively active: the global
-- kill-switch row only ever had automod=false from the old column default, and every guild
-- with an enabled AutoMod rule gets its module switched on.
UPDATE `global_modules` SET `automod` = true;--> statement-breakpoint
INSERT INTO `guild_modules` (`guild_id`, `automod`)
SELECT `guild_id`, true FROM `automod_settings`
WHERE `word_filter_enabled` OR `spam_enabled` OR `caps_enabled` OR `link_enabled`
	OR `invite_enabled` OR `mention_enabled` OR `new_account_enabled`
ON DUPLICATE KEY UPDATE `automod` = true;
