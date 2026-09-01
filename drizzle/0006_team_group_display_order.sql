ALTER TABLE `shared_team_name_groups` ADD COLUMN `display_order` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
WITH ordered AS (
	SELECT `id`, ROW_NUMBER() OVER (ORDER BY `updated_at` DESC, `id` ASC) - 1 AS `display_order`
	FROM `shared_team_name_groups`
)
UPDATE `shared_team_name_groups`
SET `display_order` = (
	SELECT `ordered`.`display_order`
	FROM `ordered`
	WHERE `ordered`.`id` = `shared_team_name_groups`.`id`
);
--> statement-breakpoint
CREATE INDEX `shared_team_name_groups_order_idx` ON `shared_team_name_groups` (`display_order`);
