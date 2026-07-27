CREATE TABLE `shared_matches` (
	`match_id` text PRIMARY KEY NOT NULL,
	`business_date` text NOT NULL,
	`data_json` text NOT NULL,
	`updated_by` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `shared_matches_date_idx` ON `shared_matches` (`business_date`);--> statement-breakpoint
CREATE TABLE `user_orders` (
	`user_id` text NOT NULL,
	`order_id` text NOT NULL,
	`saved_at` text NOT NULL,
	`data_json` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`user_id`, `order_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_orders_user_saved_idx` ON `user_orders` (`user_id`,`saved_at`);--> statement-breakpoint
CREATE TABLE `user_states` (
	`user_id` text PRIMARY KEY NOT NULL,
	`settings_json` text DEFAULT '{}' NOT NULL,
	`expense_cents` integer DEFAULT 0 NOT NULL,
	`income_cents` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`auth_subject` text NOT NULL,
	`account` text NOT NULL,
	`normalized_account` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_auth_subject_unique` ON `users` (`auth_subject`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_normalized_account_unique` ON `users` (`normalized_account`);