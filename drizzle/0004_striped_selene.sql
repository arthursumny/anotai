CREATE TABLE `knowledge_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`title` text NOT NULL,
	`category` text NOT NULL,
	`content` text NOT NULL,
	`state` text DEFAULT 'draft' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`date` text DEFAULT '' NOT NULL,
	`key` text,
	`filename` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `recording_parts` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`key` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`digest` text NOT NULL,
	`transcript` text,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `recordings` (
	`file_id` text PRIMARY KEY NOT NULL,
	`complete` integer DEFAULT 0 NOT NULL,
	`part_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action
);
