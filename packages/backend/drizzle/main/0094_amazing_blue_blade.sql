CREATE TABLE `user_login_states` (
	`user_id` text PRIMARY KEY NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`last_failed_at` integer,
	`locked_until` integer,
	`sessions_valid_after` integer
);
