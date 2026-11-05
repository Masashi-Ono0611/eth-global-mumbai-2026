CREATE TABLE `styld_auth_credentials` (
	`credential_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`revision` text NOT NULL,
	`active` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `styld_auth_identifiers` (
	`namespace` text NOT NULL,
	`value` text NOT NULL,
	`module_id` text,
	`credential_id` text,
	`subject_id` text NOT NULL,
	`revision` text NOT NULL,
	`verified_at` integer,
	`active` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `styld_auth_passwords` (
	`module_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`credential_revision` text NOT NULL,
	`verifier_version` text NOT NULL,
	`verifier` text NOT NULL,
	`normalization` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `styld_auth_pending` (
	`module_id` text NOT NULL,
	`kind` text NOT NULL,
	`digest` text NOT NULL,
	`version` text NOT NULL,
	`flow_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`binding_digest` text NOT NULL,
	`snapshot` text NOT NULL,
	`expires_at` integer NOT NULL,
	`attempt_limit` integer NOT NULL,
	`failed_attempts` integer NOT NULL,
	`consumed` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `styld_auth_sessions` (
	`session_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`digest` text NOT NULL,
	`security_revision` text NOT NULL,
	`issued_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`absolute_expires_at` integer NOT NULL,
	`record` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `styld_auth_credentials_key_0` ON `styld_auth_credentials` (`credential_id`);--> statement-breakpoint
CREATE INDEX `styld_auth_credentials_index_0` ON `styld_auth_credentials` (`subject_id`,`active`,`credential_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `styld_auth_identifiers_key_0` ON `styld_auth_identifiers` (`namespace`,`value`);--> statement-breakpoint
CREATE INDEX `styld_auth_identifiers_index_0` ON `styld_auth_identifiers` (`subject_id`,`namespace`,`value`);--> statement-breakpoint
CREATE UNIQUE INDEX `styld_auth_passwords_key_0` ON `styld_auth_passwords` (`module_id`,`subject_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `styld_auth_passwords_key_1` ON `styld_auth_passwords` (`module_id`,`credential_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `styld_auth_pending_key_0` ON `styld_auth_pending` (`digest`);--> statement-breakpoint
CREATE INDEX `styld_auth_pending_index_0` ON `styld_auth_pending` (`module_id`,`expires_at`,`digest`);--> statement-breakpoint
CREATE UNIQUE INDEX `styld_auth_sessions_key_0` ON `styld_auth_sessions` (`session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `styld_auth_sessions_key_1` ON `styld_auth_sessions` (`digest`);--> statement-breakpoint
CREATE INDEX `styld_auth_sessions_index_0` ON `styld_auth_sessions` (`subject_id`,`security_revision`,`session_id`);