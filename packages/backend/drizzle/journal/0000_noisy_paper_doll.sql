CREATE TABLE `journal_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_date` integer NOT NULL,
	`description` text NOT NULL,
	`source_type` text NOT NULL,
	`source_ref_id` text NOT NULL,
	`event_type` text NOT NULL,
	`total_debit_amount` integer NOT NULL,
	`total_credit_amount` integer NOT NULL,
	`reversal_of_batch_id` text,
	`memo` text,
	`posted_by_id` text NOT NULL,
	`posted_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `journal_batches_source_unique` ON `journal_batches` (`source_type`,`source_ref_id`,`event_type`);--> statement-breakpoint
CREATE INDEX `journal_batches_entry_date_idx` ON `journal_batches` (`entry_date`);--> statement-breakpoint
CREATE TABLE `journal_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`line_no` integer NOT NULL,
	`side` text NOT NULL,
	`account_code` text NOT NULL,
	`account_name` text NOT NULL,
	`external_mapping_code` text,
	`amount` integer NOT NULL,
	`tax_category_code` text,
	`tax_rate` real,
	`item_id` text,
	`item_name` text,
	`source_ref_item_id` text,
	`memo` text,
	FOREIGN KEY (`batch_id`) REFERENCES `journal_batches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `journal_lines_batch_id_idx` ON `journal_lines` (`batch_id`);