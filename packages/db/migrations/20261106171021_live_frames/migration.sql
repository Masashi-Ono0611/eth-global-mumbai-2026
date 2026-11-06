CREATE TABLE `live_frames` (
	`robot_id` text PRIMARY KEY,
	`frame_sha256` text NOT NULL,
	`bytes` integer NOT NULL,
	`captured_at` integer NOT NULL,
	`received_at` integer NOT NULL
);
