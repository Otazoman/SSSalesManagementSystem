CREATE TABLE `journal_posting_rules` (
	`event_type` text PRIMARY KEY NOT NULL,
	`variable_account_priority` text DEFAULT 'ITEM_MASTER_FIRST' NOT NULL,
	`variable_account_fallback_code` text,
	`prepaid_account_code` text,
	`advance_received_account_code` text,
	`cash_account_code` text,
	`payable_account_code` text,
	`receivable_account_code` text,
	`tax_account_code` text,
	`enabled` integer DEFAULT false NOT NULL,
	`memo` text,
	`updated_by` text,
	`updated_at` integer,
	FOREIGN KEY (`variable_account_fallback_code`) REFERENCES `accounts`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`prepaid_account_code`) REFERENCES `accounts`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`advance_received_account_code`) REFERENCES `accounts`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cash_account_code`) REFERENCES `accounts`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payable_account_code`) REFERENCES `accounts`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`receivable_account_code`) REFERENCES `accounts`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tax_account_code`) REFERENCES `accounts`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `journal_posting_events` (
	`id` text PRIMARY KEY NOT NULL,
	`source_type` text NOT NULL,
	`source_ref_id` text NOT NULL,
	`event_type` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`posted_batch_id` text,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`requested_by_id` text NOT NULL,
	`requested_at` integer NOT NULL,
	`posted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `journal_posting_events_source_unique` ON `journal_posting_events` (`source_type`,`source_ref_id`,`event_type`);--> statement-breakpoint
CREATE INDEX `journal_posting_events_status_idx` ON `journal_posting_events` (`status`);--> statement-breakpoint
ALTER TABLE `sales_orders` ADD `prepaid_at` integer;--> statement-breakpoint
ALTER TABLE `sales_orders` ADD `is_prepaid` integer DEFAULT false NOT NULL;