CREATE TABLE `otp_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`document_type` text DEFAULT 'sales_quote' NOT NULL,
	`document_id` text NOT NULL,
	`attachment_id` text NOT NULL,
	`email` text NOT NULL,
	`otp_code` text NOT NULL,
	`expires_at` integer NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`verified_at` integer,
	`created_at` integer NOT NULL
);
