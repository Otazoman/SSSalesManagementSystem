PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_mail_delivery_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text DEFAULT 'email' NOT NULL,
	`category` text NOT NULL,
	`document_id` text NOT NULL,
	`smtp_from` text,
	`recipient_to` text NOT NULL,
	`recipient_cc` text,
	`subject` text NOT NULL,
	`body` text,
	`attached_r2_path` text,
	`status` text NOT NULL,
	`error_message` text,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer,
	`performed_by_id` text,
	`performed_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_mail_delivery_logs`("id", "category", "document_id", "smtp_from", "recipient_to", "recipient_cc", "subject", "attached_r2_path", "status", "error_message", "performed_by_id", "performed_at") SELECT "id", "category", "document_id", "smtp_from", "recipient_to", "recipient_cc", "subject", "attached_r2_path", "status", "error_message", "performed_by_id", "performed_at" FROM `mail_delivery_logs`;--> statement-breakpoint
DROP TABLE `mail_delivery_logs`;--> statement-breakpoint
ALTER TABLE `__new_mail_delivery_logs` RENAME TO `mail_delivery_logs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;