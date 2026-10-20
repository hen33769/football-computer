CREATE TABLE `user_team_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`short_text` text DEFAULT '' NOT NULL,
	`color` text NOT NULL,
	`date_basis` text DEFAULT 'current' NOT NULL,
	`start_date` text,
	`end_date` text,
	`display_order` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CHECK (`date_basis` IN ('current', 'match'))
);
--> statement-breakpoint
CREATE INDEX `user_team_tags_user_order_idx` ON `user_team_tags` (`user_id`,`display_order`,`id`);
--> statement-breakpoint
CREATE TABLE `user_team_tag_members` (
	`id` text PRIMARY KEY NOT NULL,
	`tag_id` text NOT NULL,
	`source_name` text NOT NULL,
	`source_name_key` text NOT NULL,
	`team_group_id` text,
	`note` text DEFAULT '' NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tag_id`) REFERENCES `user_team_tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_team_tag_members_name_unique` ON `user_team_tag_members` (`tag_id`,`source_name_key`);
--> statement-breakpoint
CREATE INDEX `user_team_tag_members_tag_order_idx` ON `user_team_tag_members` (`tag_id`,`display_order`,`id`);
--> statement-breakpoint
CREATE TABLE `team_tag_shares` (
	`id` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`owner_id` text NOT NULL,
	`source_tag_id` text,
	`snapshot_version` integer DEFAULT 1 NOT NULL,
	`snapshot_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_tag_shares_code_hash_unique` ON `team_tag_shares` (`code_hash`);
--> statement-breakpoint
CREATE INDEX `team_tag_shares_owner_created_idx` ON `team_tag_shares` (`owner_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `team_tag_shares_expires_idx` ON `team_tag_shares` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `user_team_tag_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`share_id` text NOT NULL,
	`request_id` text NOT NULL,
	`target_tag_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`share_id`) REFERENCES `team_tag_shares`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_tag_id`) REFERENCES `user_team_tags`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_team_tag_imports_share_unique` ON `user_team_tag_imports` (`user_id`,`share_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_team_tag_imports_request_unique` ON `user_team_tag_imports` (`user_id`,`request_id`);
