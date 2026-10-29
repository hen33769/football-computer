CREATE TABLE `user_personal_data_revisions` (
	`user_id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`origin_id` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_personal_data_revisions_origin_unique` ON `user_personal_data_revisions` (`origin_id`);
--> statement-breakpoint
INSERT INTO `user_personal_data_revisions` (`user_id`, `revision`, `origin_id`, `updated_at`)
SELECT `id`, 0, lower(hex(randomblob(16))), CURRENT_TIMESTAMP FROM `users`;
--> statement-breakpoint
CREATE TABLE `user_finance_ledgers` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`source` text DEFAULT 'native' NOT NULL,
	`restore_operation_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_finance_ledgers_user_status_idx` ON `user_finance_ledgers` (`user_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_finance_ledgers_active_unique` ON `user_finance_ledgers` (`user_id`) WHERE `status` = 'active';
--> statement-breakpoint
INSERT INTO `user_finance_ledgers` (`id`, `user_id`, `status`, `source`, `created_at`)
SELECT 'legacy-ledger:' || `user_id`, `user_id`, 'active', 'legacy-migration', CURRENT_TIMESTAMP
FROM `user_finance_corrections`;
--> statement-breakpoint
ALTER TABLE `user_finance_corrections` ADD `active_ledger_id` text;
--> statement-breakpoint
UPDATE `user_finance_corrections`
SET `active_ledger_id` = 'legacy-ledger:' || `user_id`
WHERE `active_ledger_id` IS NULL;
--> statement-breakpoint
CREATE TABLE `user_finance_correction_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`ledger_id` text NOT NULL,
	`origin_id` text NOT NULL,
	`origin_entry_id` text NOT NULL,
	`kind` text NOT NULL,
	`delta_cents` integer NOT NULL,
	`effective_date` text,
	`note` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`request_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`source_created_at` text,
	`correction_before_cents` integer NOT NULL,
	`correction_after_cents` integer NOT NULL,
	`revision_after` integer NOT NULL,
	`adjusts_entry_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ledger_id`) REFERENCES `user_finance_ledgers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`adjusts_entry_id`) REFERENCES `user_finance_correction_entries`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_finance_entries_origin_unique` ON `user_finance_correction_entries` (`ledger_id`,`origin_id`,`origin_entry_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_finance_entries_request_unique` ON `user_finance_correction_entries` (`user_id`,`request_id`) WHERE `request_id` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `user_finance_entries_history_idx` ON `user_finance_correction_entries` (`user_id`,`ledger_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `user_finance_entries_trend_idx` ON `user_finance_correction_entries` (`ledger_id`,`effective_date`,`kind`);
--> statement-breakpoint
INSERT INTO `user_finance_correction_entries` (
	`id`, `user_id`, `ledger_id`, `origin_id`, `origin_entry_id`, `kind`, `delta_cents`,
	`effective_date`, `note`, `source`, `request_id`, `created_at`, `source_created_at`,
	`correction_before_cents`, `correction_after_cents`, `revision_after`, `adjusts_entry_id`
)
SELECT
	'legacy-expense:' || c.`user_id`, c.`user_id`, 'legacy-ledger:' || c.`user_id`, r.`origin_id`,
	'legacy-expense', 'expense', c.`expense_correction_cents`, NULL,
	'升级前累计值，原始明细不可追溯', 'legacy-migration', NULL, CURRENT_TIMESTAMP, c.`updated_at`,
	0, c.`expense_correction_cents`, c.`revision`, NULL
FROM `user_finance_corrections` c
JOIN `user_personal_data_revisions` r ON r.`user_id` = c.`user_id`
WHERE c.`expense_correction_cents` <> 0;
--> statement-breakpoint
INSERT INTO `user_finance_correction_entries` (
	`id`, `user_id`, `ledger_id`, `origin_id`, `origin_entry_id`, `kind`, `delta_cents`,
	`effective_date`, `note`, `source`, `request_id`, `created_at`, `source_created_at`,
	`correction_before_cents`, `correction_after_cents`, `revision_after`, `adjusts_entry_id`
)
SELECT
	'legacy-income:' || c.`user_id`, c.`user_id`, 'legacy-ledger:' || c.`user_id`, r.`origin_id`,
	'legacy-income', 'income', c.`income_correction_cents`, NULL,
	'升级前累计值，原始明细不可追溯', 'legacy-migration', NULL, CURRENT_TIMESTAMP, c.`updated_at`,
	0, c.`income_correction_cents`, c.`revision`, NULL
FROM `user_finance_corrections` c
JOIN `user_personal_data_revisions` r ON r.`user_id` = c.`user_id`
WHERE c.`income_correction_cents` <> 0;
--> statement-breakpoint
CREATE TABLE `user_data_import_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`request_id` text NOT NULL,
	`payload_digest` text NOT NULL,
	`strategy` text NOT NULL,
	`expected_data_revision` integer NOT NULL,
	`status` text DEFAULT 'staging' NOT NULL,
	`result_json` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_data_import_operations_request_unique` ON `user_data_import_operations` (`user_id`,`request_id`);
--> statement-breakpoint
CREATE INDEX `user_data_import_operations_status_idx` ON `user_data_import_operations` (`status`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `user_data_import_staging` (
	`operation_id` text NOT NULL,
	`record_kind` text NOT NULL,
	`record_key` text NOT NULL,
	`payload_json` text NOT NULL,
	PRIMARY KEY (`operation_id`,`record_kind`,`record_key`),
	FOREIGN KEY (`operation_id`) REFERENCES `user_data_import_operations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_data_import_staging_operation_idx` ON `user_data_import_staging` (`operation_id`,`record_kind`);
