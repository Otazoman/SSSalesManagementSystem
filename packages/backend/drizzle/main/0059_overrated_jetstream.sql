PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_purchase_request_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`purchase_request_item_id` text,
	`file_name` text NOT NULL,
	`attachment_r2_path` text,
	`uploaded_by_id` text NOT NULL,
	`uploaded_at` integer NOT NULL,
	`storage_type` text DEFAULT 'R2' NOT NULL,
	`external_url` text,
	FOREIGN KEY (`request_id`) REFERENCES `purchase_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purchase_request_item_id`) REFERENCES `purchase_request_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_purchase_request_attachments`("id", "request_id", "purchase_request_item_id", "file_name", "attachment_r2_path", "uploaded_by_id", "uploaded_at", "storage_type", "external_url") SELECT "id", "request_id", "purchase_request_item_id", "file_name", "attachment_r2_path", "uploaded_by_id", "uploaded_at", "storage_type", "external_url" FROM `purchase_request_attachments`;--> statement-breakpoint
DROP TABLE `purchase_request_attachments`;--> statement-breakpoint
ALTER TABLE `__new_purchase_request_attachments` RENAME TO `purchase_request_attachments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;