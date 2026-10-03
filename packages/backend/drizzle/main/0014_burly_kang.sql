CREATE TABLE `warehouse_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`warehouse_id` text NOT NULL,
	`file_name` text NOT NULL,
	`storage_type` text DEFAULT 'R2' NOT NULL,
	`attachment_r2_path` text,
	`external_url` text,
	`file_type` text DEFAULT 'OTHER' NOT NULL,
	`uploaded_by_id` text NOT NULL,
	`uploaded_at` integer NOT NULL,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
