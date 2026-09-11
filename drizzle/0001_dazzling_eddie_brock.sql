CREATE TABLE `memory_chats` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `memory_chat_owner` ON `memory_chats` (`org_id`,`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `memory_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`question` text NOT NULL,
	`filters` text NOT NULL,
	`answer` text,
	`dependencies` text DEFAULT '[]' NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `memory_chats`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `memory_turn_chat` ON `memory_turns` (`chat_id`,`created_at`);