CREATE TABLE `customer_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`file_name` text NOT NULL,
	`storage_type` text DEFAULT 'R2' NOT NULL,
	`attachment_r2_path` text,
	`external_url` text,
	`file_type` text DEFAULT 'OTHER' NOT NULL,
	`uploaded_by_id` text NOT NULL,
	`uploaded_at` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `customers` ADD `anti_social_check_status` text DEFAULT 'UNCHECKED';--> statement-breakpoint
ALTER TABLE `customers` ADD `anti_social_check_memo` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `contract_date` integer;--> statement-breakpoint
ALTER TABLE `customers` ADD `contract_valid_to` integer;