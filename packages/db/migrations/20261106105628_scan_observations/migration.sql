CREATE TABLE `observations` (
	`id` text PRIMARY KEY,
	`robot_id` text NOT NULL,
	`episode_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`frame_sha256` text NOT NULL,
	`bytes` integer NOT NULL,
	`captured_at` integer NOT NULL,
	`chip_sig` text NOT NULL,
	`r2_key` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `observations_robot_invoice` ON `observations` (`robot_id`,`invoice_id`);--> statement-breakpoint
CREATE INDEX `observations_episode_id` ON `observations` (`episode_id`);