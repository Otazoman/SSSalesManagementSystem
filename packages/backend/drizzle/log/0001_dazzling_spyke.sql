CREATE TABLE `mail_delivery_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`document_id` text NOT NULL,
	`smtp_from` text NOT NULL,
	`recipient_to` text NOT NULL,
	`recipient_cc` text,
	`subject` text NOT NULL,
	`attached_r2_path` text,
	`status` text NOT NULL,
	`error_message` text,
	`performed_by_id` text,
	`performed_at` integer NOT NULL
);
