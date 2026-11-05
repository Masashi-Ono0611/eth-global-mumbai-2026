CREATE TABLE `accounts` (
	`id` text PRIMARY KEY,
	`enabled` integer DEFAULT true NOT NULL,
	`security_revision` text NOT NULL,
	`display_name` text NOT NULL,
	`created_at` integer NOT NULL
);
