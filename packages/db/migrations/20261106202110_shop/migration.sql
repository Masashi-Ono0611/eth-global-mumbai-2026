CREATE TABLE `shop_cursor` (
	`id` text PRIMARY KEY,
	`block` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shop_orders` (
	`id` text PRIMARY KEY,
	`kit` text NOT NULL,
	`pay` text NOT NULL,
	`founding` integer NOT NULL,
	`amount` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`address` text NOT NULL,
	`country` text NOT NULL,
	`status` text NOT NULL,
	`paid_tx` text,
	`paid_at` integer,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shop_payments` (
	`id` text PRIMARY KEY,
	`tx_hash` text NOT NULL,
	`from_address` text NOT NULL,
	`amount` text NOT NULL,
	`block` integer NOT NULL,
	`order_id` text,
	`seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `shop_orders_amount` ON `shop_orders` (`amount`);--> statement-breakpoint
CREATE INDEX `shop_orders_kit_status` ON `shop_orders` (`kit`,`status`);