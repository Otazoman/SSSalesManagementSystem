CREATE TABLE `receipt_instruction_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`instruction_id` text NOT NULL,
	`file_name` text NOT NULL,
	`storage_type` text DEFAULT 'R2' NOT NULL,
	`attachment_r2_path` text,
	`file_type` text DEFAULT 'PDF' NOT NULL,
	`uploaded_by_id` text NOT NULL,
	`uploaded_at` integer NOT NULL,
	FOREIGN KEY (`instruction_id`) REFERENCES `item_receipt_instructions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `shipment_instruction_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`instruction_id` text NOT NULL,
	`file_name` text NOT NULL,
	`storage_type` text DEFAULT 'R2' NOT NULL,
	`attachment_r2_path` text,
	`file_type` text DEFAULT 'PDF' NOT NULL,
	`uploaded_by_id` text NOT NULL,
	`uploaded_at` integer NOT NULL,
	FOREIGN KEY (`instruction_id`) REFERENCES `item_shipment_instructions`(`id`) ON UPDATE no action ON DELETE cascade
);
