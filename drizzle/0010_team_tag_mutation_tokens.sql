ALTER TABLE `user_team_tags` ADD `mutation_token` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `user_team_tag_members` ADD `mutation_token` text DEFAULT '' NOT NULL;
