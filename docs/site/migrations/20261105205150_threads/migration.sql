ALTER TABLE `comments` ADD `parent_id` text;--> statement-breakpoint
ALTER TABLE `comments` ADD `status` text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE `comments` ADD `status_by` text;--> statement-breakpoint
ALTER TABLE `comments` ADD `status_at` text;--> statement-breakpoint
CREATE INDEX `comments_parent` ON `comments` (`parent_id`);