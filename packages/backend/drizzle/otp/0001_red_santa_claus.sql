CREATE TABLE `login_otp_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`channel` text NOT NULL,
	`expires_at` integer NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`last_sent_at` integer NOT NULL,
	`verified_at` integer,
	`created_at` integer NOT NULL
);
