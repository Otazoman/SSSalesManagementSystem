CREATE TABLE `cash_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`partner_id` text NOT NULL,
	`receipt_date` integer NOT NULL,
	`amount` integer NOT NULL,
	`method` text DEFAULT 'BANK_TRANSFER' NOT NULL,
	`memo` text,
	`status` text DEFAULT 'UNLINKED' NOT NULL,
	`billing_header_id` text,
	`linked_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`billing_header_id`) REFERENCES `billing_headers`(`id`) ON UPDATE no action ON DELETE no action
);
