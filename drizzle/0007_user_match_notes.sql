CREATE TABLE `user_match_notes` (
	`user_id` text NOT NULL,
	`match_id` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`user_id`, `match_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
