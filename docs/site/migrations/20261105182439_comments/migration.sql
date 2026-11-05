CREATE TABLE `comments` (
	`id` text PRIMARY KEY,
	`page` text NOT NULL,
	`anchor` text NOT NULL,
	`anchor_text` text NOT NULL,
	`name` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `comments_page` ON `comments` (`page`,`created_at`);