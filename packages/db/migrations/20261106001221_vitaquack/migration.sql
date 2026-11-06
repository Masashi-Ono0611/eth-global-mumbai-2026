-- accounts is recreated rather than altered: SQLite cannot ADD a NOT NULL column without a default, and the old rows
-- were password-auth (Yielded) accounts with no smart account; passkey signup recreates them.
DROP TABLE `accounts`;
--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY,
	`display_name` text NOT NULL,
	`security_revision` text NOT NULL,
	`smart_account` text NOT NULL,
	`deploy_salt` text NOT NULL,
	`eoa_owner` text,
	`deploy_status` text NOT NULL,
	`deploy_tx` text,
	`world_sub` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `approvals` (
	`id` text PRIMARY KEY,
	`account_id` text,
	`robot_id` text,
	`episode_id` text,
	`invoice_id` text,
	`invoice_hash` text,
	`payee` text,
	`amount` text,
	`expiry` integer,
	`nonce` text NOT NULL,
	`oidc_state` text NOT NULL,
	`oidc_nonce` text NOT NULL,
	`status` text NOT NULL,
	`jti` text,
	`sub` text,
	`auth_time` integer,
	`amr_json` text,
	`signature` text,
	`error` text,
	`created_at` integer NOT NULL,
	`decided_at` integer
);
--> statement-breakpoint
CREATE TABLE `auth_challenges` (
	`id` text PRIMARY KEY,
	`kind` text NOT NULL,
	`account_id` text,
	`ref` text,
	`expires_at` integer NOT NULL,
	`used` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chip_requests` (
	`id` text PRIMARY KEY,
	`robot_id` text,
	`episode_id` text,
	`kind` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text NOT NULL,
	`expires_at` integer,
	`delivered_at` integer,
	`responded_at` integer,
	`signature` text,
	`leaf_hash` text,
	`refusal_code` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `decisions` (
	`id` text PRIMARY KEY,
	`episode_id` text,
	`step` integer,
	`model` text,
	`request_id` text,
	`chat_id` text,
	`provider` text,
	`latency_ms` integer,
	`prompt_sha256` text,
	`input_json` text,
	`action` text NOT NULL,
	`reason` text,
	`outcome` text,
	`outcome_ref` text,
	`error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `episodes` (
	`id` text PRIMARY KEY,
	`robot_id` text,
	`account_id` text,
	`item` text,
	`invoice_id` text,
	`state` text NOT NULL,
	`decision_count` integer,
	`result` text,
	`request_ids_hash` text,
	`state_changed_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `evidence_uploads` (
	`episode_id` text PRIMARY KEY,
	`status` text NOT NULL,
	`payload_json` text,
	`request_ids_hash` text,
	`root_hash` text,
	`storage_tx` text,
	`log_tx` text,
	`attempts` integer,
	`claimed_at` integer,
	`uploaded_at` integer,
	`error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `grants` (
	`id` text PRIMARY KEY,
	`robot_id` text,
	`account_id` text,
	`delegation_hash` text NOT NULL,
	`delegation_json` text,
	`daily_cap` text,
	`per_payment_cap` text,
	`allowlist_json` text,
	`start_at` integer,
	`expires_at` integer,
	`status` text NOT NULL,
	`revoke_tx` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY,
	`merchant_id` text,
	`item_id` text,
	`pay_to` text,
	`asset` text,
	`amount` text,
	`expires_at` integer,
	`lines_hash` text,
	`rules_hash` text,
	`invoice_hash` text NOT NULL,
	`restricted` integer,
	`status` text NOT NULL,
	`paid_tx` text,
	`used_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `passkeys` (
	`credential_id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`alg` integer NOT NULL,
	`spki` text NOT NULL,
	`x` text NOT NULL,
	`y` text NOT NULL,
	`sign_count` integer NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`invoice_hash` text PRIMARY KEY,
	`invoice_id` text,
	`robot_id` text,
	`episode_id` text,
	`payer` text,
	`delegation_manager` text,
	`context_sha256` text,
	`approval_id` text,
	`status` text NOT NULL,
	`tx_hash` text,
	`gas_used` text,
	`fail_reason` text,
	`created_at` integer NOT NULL,
	`settled_at` integer
);
--> statement-breakpoint
CREATE TABLE `relayer_txs` (
	`key` text PRIMARY KEY,
	`kind` text,
	`nonce` integer,
	`to_address` text,
	`data_sha256` text,
	`tx_hash` text,
	`status` text NOT NULL,
	`gas_used` text,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `robots` (
	`id` text PRIMARY KEY,
	`account_id` text,
	`name` text,
	`pairing_code` text,
	`pairing_expires_at` integer,
	`chip_address` text,
	`chip_token_hash` text,
	`paired_at` integer,
	`last_poll_at` integer,
	`lease_until` integer,
	`status` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `used_nonces` (
	`nonce` text PRIMARY KEY,
	`kind` text,
	`ref` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
DROP INDEX IF EXISTS `auth_attempt_buckets_expiry`;--> statement-breakpoint
DROP INDEX IF EXISTS `styld_auth_credentials_key_0`;--> statement-breakpoint
DROP INDEX IF EXISTS `styld_auth_credentials_index_0`;--> statement-breakpoint
DROP INDEX IF EXISTS `styld_auth_identifiers_key_0`;--> statement-breakpoint
DROP INDEX IF EXISTS `styld_auth_identifiers_index_0`;--> statement-breakpoint
DROP INDEX IF EXISTS `styld_auth_passwords_key_0`;--> statement-breakpoint
DROP INDEX IF EXISTS `styld_auth_passwords_key_1`;--> statement-breakpoint
DROP INDEX IF EXISTS `styld_auth_pending_key_0`;--> statement-breakpoint
DROP INDEX IF EXISTS `styld_auth_pending_index_0`;--> statement-breakpoint
DROP INDEX IF EXISTS `styld_auth_sessions_key_0`;--> statement-breakpoint
DROP INDEX IF EXISTS `styld_auth_sessions_key_1`;--> statement-breakpoint
DROP INDEX IF EXISTS `styld_auth_sessions_index_0`;--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_smart_account` ON `accounts` (`smart_account`);--> statement-breakpoint
CREATE UNIQUE INDEX `approvals_nonce` ON `approvals` (`nonce`);--> statement-breakpoint
CREATE UNIQUE INDEX `approvals_oidc_state` ON `approvals` (`oidc_state`);--> statement-breakpoint
CREATE UNIQUE INDEX `approvals_jti` ON `approvals` (`jti`);--> statement-breakpoint
CREATE INDEX `auth_challenges_expires_at` ON `auth_challenges` (`expires_at`);--> statement-breakpoint
CREATE INDEX `chip_requests_robot_status` ON `chip_requests` (`robot_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `chip_requests_episode_id` ON `chip_requests` (`episode_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `decisions_episode_step` ON `decisions` (`episode_id`,`step`);--> statement-breakpoint
CREATE INDEX `episodes_robot_created` ON `episodes` (`robot_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `evidence_uploads_status` ON `evidence_uploads` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `grants_delegation_hash` ON `grants` (`delegation_hash`);--> statement-breakpoint
CREATE INDEX `grants_robot_status` ON `grants` (`robot_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_invoice_hash` ON `invoices` (`invoice_hash`);--> statement-breakpoint
CREATE INDEX `passkeys_account_id` ON `passkeys` (`account_id`);--> statement-breakpoint
CREATE INDEX `payments_episode_id` ON `payments` (`episode_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `relayer_txs_nonce` ON `relayer_txs` (`nonce`);--> statement-breakpoint
CREATE UNIQUE INDEX `robots_pairing_code` ON `robots` (`pairing_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `robots_chip_address` ON `robots` (`chip_address`);--> statement-breakpoint
CREATE INDEX `robots_account_id` ON `robots` (`account_id`);--> statement-breakpoint
DROP TABLE `auth_attempt_buckets`;--> statement-breakpoint
DROP TABLE `styld_auth_credentials`;--> statement-breakpoint
DROP TABLE `styld_auth_identifiers`;--> statement-breakpoint
DROP TABLE `styld_auth_passwords`;--> statement-breakpoint
DROP TABLE `styld_auth_pending`;--> statement-breakpoint
DROP TABLE `styld_auth_sessions`;
