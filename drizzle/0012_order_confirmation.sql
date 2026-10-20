ALTER TABLE `user_orders` ADD COLUMN `confirmed_at` text;
--> statement-breakpoint
CREATE INDEX `user_orders_user_confirmation_idx`
ON `user_orders` (`user_id`, `confirmed_at`, `settled_at`, `status`, `saved_at`);
