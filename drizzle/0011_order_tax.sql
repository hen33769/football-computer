ALTER TABLE `user_orders` ADD COLUMN `tax_cents` integer;
--> statement-breakpoint
UPDATE `user_orders`
SET `tax_cents` = CAST(ROUND(`settled_prize_cents` * 0.2) AS INTEGER)
WHERE `settled_at` IS NOT NULL
  AND `status` = 'success'
  AND `settled_prize_cents` > 1000000;
--> statement-breakpoint
UPDATE `user_orders`
SET `data_json` = json_set(`data_json`, '$.taxAmount', `tax_cents` / 100.0)
WHERE `tax_cents` IS NOT NULL;
