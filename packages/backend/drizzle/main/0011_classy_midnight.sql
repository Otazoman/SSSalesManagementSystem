CREATE TABLE `mail_template_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`smtp_from` text,
	`cc_address` text,
	`bcc_address` text,
	`subject_template` text NOT NULL,
	`body_template` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text
);
