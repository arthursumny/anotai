CREATE TABLE `meeting_materials` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`meeting_id` text NOT NULL,
	`author_id` text NOT NULL,
	`revision` integer NOT NULL,
	`key` text NOT NULL,
	`snapshot` text NOT NULL,
	`dependencies` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `material_meeting_created` ON `meeting_materials` (`meeting_id`,`created_at`);