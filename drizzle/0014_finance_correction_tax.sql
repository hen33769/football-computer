ALTER TABLE `user_finance_corrections` ADD `income_tax_correction_cents` integer DEFAULT 0 NOT NULL;

ALTER TABLE `user_finance_correction_entries` ADD `tax_delta_cents` integer DEFAULT 0 NOT NULL;

ALTER TABLE `user_finance_correction_entries` ADD `tax_correction_before_cents` integer DEFAULT 0 NOT NULL;

ALTER TABLE `user_finance_correction_entries` ADD `tax_correction_after_cents` integer DEFAULT 0 NOT NULL;
