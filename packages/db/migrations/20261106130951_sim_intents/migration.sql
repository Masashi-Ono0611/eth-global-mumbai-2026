CREATE TABLE `intents` (
	`id` text PRIMARY KEY,
	`robot_id` text NOT NULL,
	`account_id` text NOT NULL,
	`instruction` text NOT NULL,
	`instruction_sha256` text NOT NULL,
	`item` text,
	`state` text NOT NULL,
	`turn` integer DEFAULT 0 NOT NULL,
	`busy_until` integer,
	`episode_id` text,
	`reason` text,
	`created_at` integer NOT NULL,
	`ended_at` integer
);
--> statement-breakpoint
CREATE TABLE `nav_turns` (
	`id` text PRIMARY KEY,
	`intent_id` text NOT NULL,
	`step` integer NOT NULL,
	`model` text NOT NULL,
	`request_id` text,
	`chat_id` text,
	`provider` text,
	`latency_ms` integer,
	`prompt_sha256` text NOT NULL,
	`calls_json` text NOT NULL,
	`reasoning` text,
	`results_json` text,
	`error` text,
	`tee_json` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `robots` ADD `kind` text DEFAULT 'chip' NOT NULL;--> statement-breakpoint
CREATE INDEX `intents_robot_created` ON `intents` (`robot_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `nav_turns_intent_step` ON `nav_turns` (`intent_id`,`step`);