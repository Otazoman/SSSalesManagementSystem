CREATE TABLE `warehouse_available_days` (
	`id` text PRIMARY KEY NOT NULL,
	`warehouse_id` text NOT NULL,
	`available_day_of_week` text NOT NULL,
	`time_slot_memo` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `warehouses` ADD `business_start_time` text;--> statement-breakpoint
ALTER TABLE `warehouses` ADD `business_end_time` text;--> statement-breakpoint
ALTER TABLE `warehouses` ADD `storage_restrictions` text;--> statement-breakpoint
ALTER TABLE `warehouses` DROP COLUMN `closing_day`;--> statement-breakpoint
ALTER TABLE `warehouses` DROP COLUMN `payment_month_offset`;--> statement-breakpoint
ALTER TABLE `warehouses` DROP COLUMN `payment_day`;