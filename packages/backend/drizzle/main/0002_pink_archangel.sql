CREATE TABLE `item_approval_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`request_type` text NOT NULL,
	`status` text NOT NULL,
	`applicant_id` text NOT NULL,
	`approver_id` text,
	`comment` text,
	`attachment_r2_path` text,
	`memo` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`applicant_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approver_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `items` ADD `status` text DEFAULT 'temporary' NOT NULL;--> statement-breakpoint
ALTER TABLE `items` DROP COLUMN `is_active`;