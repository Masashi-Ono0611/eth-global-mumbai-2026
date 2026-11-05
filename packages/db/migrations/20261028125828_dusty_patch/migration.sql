CREATE TABLE `auth_attempt_buckets` (
	`key` text PRIMARY KEY,
	`tokens` real NOT NULL,
	`updated_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_attempt_buckets_expiry` ON `auth_attempt_buckets` (`expires_at`);