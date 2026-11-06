CREATE TABLE `wallet_balances` (
	`account_id` text PRIMARY KEY,
	`units` text NOT NULL,
	`observed_at` integer NOT NULL
);
