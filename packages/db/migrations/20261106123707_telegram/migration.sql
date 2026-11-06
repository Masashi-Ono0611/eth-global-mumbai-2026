CREATE TABLE `notifications` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`kind` text NOT NULL,
	`subject_id` text NOT NULL,
	`payload_json` text,
	`status` text NOT NULL,
	`attempts` integer NOT NULL,
	`last_error` text,
	`claimed_at` integer,
	`created_at` integer NOT NULL,
	`sent_at` integer
);
--> statement-breakpoint
CREATE TABLE `telegram_links` (
	`account_id` text PRIMARY KEY,
	`chat_id` text,
	`username` text,
	`code_hash` text,
	`code_expires_at` integer,
	`linked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_kind_subject` ON `notifications` (`kind`,`subject_id`);--> statement-breakpoint
CREATE INDEX `notifications_status_created` ON `notifications` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `telegram_links_chat_id` ON `telegram_links` (`chat_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_links_code_hash` ON `telegram_links` (`code_hash`);