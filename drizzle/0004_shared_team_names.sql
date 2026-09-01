CREATE TABLE `shared_team_name_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`updated_by` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `shared_team_names` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`active_slot` integer,
	`updated_by` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `shared_team_name_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CHECK (`active_slot` IS NULL OR `active_slot` IN (1, 2))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shared_team_names_name_key_unique` ON `shared_team_names` (`name_key`);
--> statement-breakpoint
CREATE INDEX `shared_team_names_group_idx` ON `shared_team_names` (`group_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `shared_team_names_group_slot_unique` ON `shared_team_names` (`group_id`, `active_slot`);
