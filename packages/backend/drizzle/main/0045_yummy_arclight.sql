CREATE TABLE `warehouse_contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`warehouse_id` text NOT NULL,
	`name` text,
	`email` text,
	`phone` text,
	`is_email_target` integer DEFAULT true NOT NULL,
	`memo` text,
	`status` text DEFAULT 'temporary' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE cascade
);
