CREATE TABLE `item_receipt_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`receipt_header_id` text NOT NULL,
	`receipt_item_id` text,
	`file_name` text NOT NULL,
	`attachment_r2_path` text,
	`file_type` text DEFAULT 'OTHER' NOT NULL,
	`uploaded_by_id` text NOT NULL,
	`uploaded_at` integer NOT NULL,
	`storage_type` text DEFAULT 'R2' NOT NULL,
	`external_url` text,
	FOREIGN KEY (`receipt_header_id`) REFERENCES `item_receipt_headers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`receipt_item_id`) REFERENCES `item_receipt_items`(`id`) ON UPDATE no action ON DELETE no action
);
