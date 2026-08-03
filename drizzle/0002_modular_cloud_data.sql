CREATE TABLE `user_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`settings_json` text DEFAULT '{}' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT OR IGNORE INTO `user_settings` (`user_id`, `settings_json`, `revision`, `updated_at`)
SELECT `user_id`, `settings_json`, `revision`, `updated_at`
FROM `user_states`;
--> statement-breakpoint
CREATE TABLE `user_finance_corrections` (
	`user_id` text PRIMARY KEY NOT NULL,
	`expense_correction_cents` integer DEFAULT 0 NOT NULL,
	`income_correction_cents` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT OR IGNORE INTO `user_finance_corrections` (
	`user_id`, `expense_correction_cents`, `income_correction_cents`, `revision`, `updated_at`
)
SELECT `user_id`, `expense_cents`, `income_cents`, `revision`, `updated_at`
FROM `user_states`;
--> statement-breakpoint
DROP TABLE `user_states`;
--> statement-breakpoint
ALTER TABLE `user_orders` ADD COLUMN `name` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `user_orders` ADD COLUMN `settled_at` text;
--> statement-breakpoint
ALTER TABLE `user_orders` ADD COLUMN `settled_prize_cents` integer;
--> statement-breakpoint
ALTER TABLE `user_orders` ADD COLUMN `stake_cents` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `user_orders` ADD COLUMN `status` text DEFAULT 'hopeful' NOT NULL;
--> statement-breakpoint
ALTER TABLE `user_orders` ADD COLUMN `match_ids_json` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
CREATE INDEX `user_orders_user_progress_idx` ON `user_orders` (`user_id`,`settled_at`,`saved_at`);
--> statement-breakpoint
CREATE INDEX `user_orders_user_status_idx` ON `user_orders` (`user_id`,`status`,`saved_at`);
--> statement-breakpoint
CREATE TABLE `match_refresh_states` (
	`id` text PRIMARY KEY NOT NULL,
	`mode` text DEFAULT 'standard' NOT NULL,
	`source` text DEFAULT 'official' NOT NULL,
	`last_update_time` text DEFAULT '' NOT NULL,
	`fixed_bonus_failure_count` integer DEFAULT 0 NOT NULL,
	`last_refresh_started_at` text,
	`last_refresh_finished_at` text,
	`refresh_lock_until` text,
	`error` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
