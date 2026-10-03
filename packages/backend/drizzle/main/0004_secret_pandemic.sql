CREATE TABLE `master_approval_contexts` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`anti_social_check_status` text,
	`anti_social_check_memo` text,
	`contract_type` text,
	`contract_valid_from` integer,
	`contract_valid_to` integer,
	`contract_memo` text,
	`drawing_number` text,
	`specification_memo` text,
	`general_memo` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `master_approval_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `master_approval_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`request_type` text NOT NULL,
	`status` text NOT NULL,
	`applicant_id` text NOT NULL,
	`approver_id` text,
	`comment` text,
	`attachment_r2_path` text,
	`memo` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`applicant_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approver_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
DROP TABLE `customer_approval_requests`;--> statement-breakpoint
DROP TABLE `item_approval_requests`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_workflow_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`approver_id` text,
	`approver_role_id` text NOT NULL,
	`layer` integer NOT NULL,
	`status` text NOT NULL,
	`comment` text,
	`performed_at` integer,
	FOREIGN KEY (`approver_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approver_role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_workflow_logs`("id", "target_type", "target_id", "approver_id", "approver_role_id", "layer", "status", "comment", "performed_at") SELECT "id", "target_type", "target_id", "approver_id", "approver_role_id", "layer", "status", "comment", "performed_at" FROM `workflow_logs`;--> statement-breakpoint
DROP TABLE `workflow_logs`;--> statement-breakpoint
ALTER TABLE `__new_workflow_logs` RENAME TO `workflow_logs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `accounts` ADD `external_mapping_code` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `status` text DEFAULT 'temporary' NOT NULL;--> statement-breakpoint
ALTER TABLE `customers` ADD `closing_day` integer;--> statement-breakpoint
ALTER TABLE `customers` ADD `payment_month_offset` integer;--> statement-breakpoint
ALTER TABLE `customers` ADD `payment_day` integer;--> statement-breakpoint
ALTER TABLE `customers` ADD `payment_method` text;--> statement-breakpoint
ALTER TABLE `items` ADD `supplier_id` text REFERENCES customers(id);--> statement-breakpoint
ALTER TABLE `items` ADD `supplier_part_number` text;--> statement-breakpoint
ALTER TABLE `warehouses` ADD `closing_day` integer;--> statement-breakpoint
ALTER TABLE `warehouses` ADD `payment_month_offset` integer;--> statement-breakpoint
ALTER TABLE `warehouses` ADD `payment_day` integer;--> statement-breakpoint
ALTER TABLE `warehouses` ADD `status` text DEFAULT 'temporary' NOT NULL;