ALTER TABLE `user_orders` ADD COLUMN `payment_status` text DEFAULT 'unpaid' NOT NULL;
--> statement-breakpoint
CREATE INDEX `user_orders_user_payment_idx` ON `user_orders` (`user_id`,`payment_status`,`settled_at`,`saved_at`);
