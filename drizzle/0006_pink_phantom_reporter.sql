ALTER TABLE `auth_tokens` ADD `participant_id` text;--> statement-breakpoint
ALTER TABLE `participants` ADD `department` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `participants` ADD `responsibilities` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `participants` ADD `revision` integer DEFAULT 0 NOT NULL;