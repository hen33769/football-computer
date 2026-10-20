CREATE TABLE `team_tag_import_rate_limits` (
	`user_id` text NOT NULL,
	`window_start` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	PRIMARY KEY (`user_id`,`window_start`)
);
--> statement-breakpoint
CREATE INDEX `team_tag_import_rate_limits_window_idx` ON `team_tag_import_rate_limits` (`window_start`);
