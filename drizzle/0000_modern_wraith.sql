CREATE TABLE "auto_responders" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" varchar(20) NOT NULL,
	"name" varchar(64) NOT NULL,
	"trigger" text NOT NULL,
	"trigger_type" varchar(20) DEFAULT 'contains',
	"response" text NOT NULL,
	"embed_data" jsonb,
	"enabled" boolean DEFAULT true,
	"cooldown" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "custom_commands" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" varchar(20) NOT NULL,
	"name" varchar(32) NOT NULL,
	"response" text NOT NULL,
	"embed_data" jsonb,
	"enabled" boolean DEFAULT true,
	"usage_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "economy_settings" (
	"guild_id" varchar(20) PRIMARY KEY NOT NULL,
	"currency_name" varchar(32) DEFAULT 'coins',
	"currency_symbol" varchar(10) DEFAULT '🪙',
	"daily_amount" integer DEFAULT 100,
	"work_min_amount" integer DEFAULT 50,
	"work_max_amount" integer DEFAULT 200,
	"work_cooldown" integer DEFAULT 3600,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "giveaways" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" varchar(20) NOT NULL,
	"channel_id" varchar(20) NOT NULL,
	"message_id" varchar(20) NOT NULL,
	"host_id" varchar(20) NOT NULL,
	"prize" text NOT NULL,
	"winners_count" integer DEFAULT 1,
	"entries" jsonb DEFAULT '[]'::jsonb,
	"winners" jsonb DEFAULT '[]'::jsonb,
	"ends_at" timestamp NOT NULL,
	"ended" boolean DEFAULT false,
	"requirements" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "guild_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" varchar(20) NOT NULL,
	"user_id" varchar(20) NOT NULL,
	"xp" bigint DEFAULT 0,
	"level" integer DEFAULT 0,
	"total_messages" bigint DEFAULT 0,
	"last_xp_gain" timestamp,
	"balance" bigint DEFAULT 0,
	"bank" bigint DEFAULT 0,
	"last_daily" timestamp,
	"last_work" timestamp,
	"birthday" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "guild_rank_backgrounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" varchar(20) NOT NULL,
	"original_name" varchar(255),
	"mime_type" varchar(50) NOT NULL,
	"file_size" integer NOT NULL,
	"uploaded_by" varchar(20) NOT NULL,
	"is_active" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "guilds" (
	"id" varchar(20) PRIMARY KEY NOT NULL,
	"prefix" varchar(10) DEFAULT '!',
	"language" varchar(10) DEFAULT 'en',
	"moderation_enabled" boolean DEFAULT true,
	"music_enabled" boolean DEFAULT true,
	"leveling_enabled" boolean DEFAULT true,
	"economy_enabled" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "level_rewards" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" varchar(20) NOT NULL,
	"level" integer NOT NULL,
	"role_id" varchar(20) NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "leveling_settings" (
	"guild_id" varchar(20) PRIMARY KEY NOT NULL,
	"xp_per_message" integer DEFAULT 15,
	"xp_cooldown" integer DEFAULT 60,
	"xp_multiplier" integer DEFAULT 100,
	"announce_enabled" boolean DEFAULT true,
	"announce_channel_id" varchar(20),
	"announce_message" text DEFAULT '🎉 Congratulations {user}! You reached level {level}!',
	"ignored_channels" jsonb DEFAULT '[]'::jsonb,
	"ignored_roles" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "liked_songs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(20) NOT NULL,
	"track_uri" varchar(500) NOT NULL,
	"track_title" varchar(256) NOT NULL,
	"track_author" varchar(256),
	"thumbnail" varchar(500),
	"duration" integer,
	"liked_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "moderation_settings" (
	"guild_id" varchar(20) PRIMARY KEY NOT NULL,
	"audit_log_channel_id" varchar(20),
	"mod_log_channel_id" varchar(20),
	"automod_enabled" boolean DEFAULT false,
	"anti_spam_enabled" boolean DEFAULT false,
	"anti_raid_enabled" boolean DEFAULT false,
	"warn_threshold" integer DEFAULT 3,
	"warn_action" varchar(20) DEFAULT 'mute',
	"banned_words" jsonb DEFAULT '[]'::jsonb,
	"allowed_invites" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "music_settings" (
	"guild_id" varchar(20) PRIMARY KEY NOT NULL,
	"default_volume" integer DEFAULT 50,
	"max_queue_size" integer DEFAULT 100,
	"dj_role_id" varchar(20),
	"song_request_channel_id" varchar(20),
	"vote_skip_enabled" boolean DEFAULT true,
	"vote_skip_percentage" integer DEFAULT 50,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "playlists" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(20) NOT NULL,
	"name" varchar(64) NOT NULL,
	"tracks" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "shop_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" varchar(20) NOT NULL,
	"name" varchar(64) NOT NULL,
	"description" text,
	"price" integer NOT NULL,
	"role_id" varchar(20),
	"stock" integer,
	"enabled" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "social_feeds" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" varchar(20) NOT NULL,
	"channel_id" varchar(20) NOT NULL,
	"platform" varchar(20) NOT NULL,
	"identifier" varchar(100) NOT NULL,
	"custom_message" text,
	"last_checked" timestamp,
	"last_post_id" varchar(100),
	"enabled" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "warnings" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" varchar(20) NOT NULL,
	"user_id" varchar(20) NOT NULL,
	"moderator_id" varchar(20) NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "auto_responders" ADD CONSTRAINT "auto_responders_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_commands" ADD CONSTRAINT "custom_commands_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "economy_settings" ADD CONSTRAINT "economy_settings_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "giveaways" ADD CONSTRAINT "giveaways_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_members" ADD CONSTRAINT "guild_members_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_rank_backgrounds" ADD CONSTRAINT "guild_rank_backgrounds_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "level_rewards" ADD CONSTRAINT "level_rewards_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leveling_settings" ADD CONSTRAINT "leveling_settings_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_settings" ADD CONSTRAINT "moderation_settings_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "music_settings" ADD CONSTRAINT "music_settings_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_items" ADD CONSTRAINT "shop_items_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_feeds" ADD CONSTRAINT "social_feeds_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warnings" ADD CONSTRAINT "warnings_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guild_user_idx" ON "guild_members" USING btree ("guild_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_track_idx" ON "liked_songs" USING btree ("user_id","track_uri");