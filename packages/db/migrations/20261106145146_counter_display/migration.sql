CREATE TABLE `counter_display` (
	`merchant_id` text PRIMARY KEY,
	`invoice_id` text NOT NULL,
	`set_at` integer NOT NULL
);
