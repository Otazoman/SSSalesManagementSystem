CREATE TABLE `payment_disbursements` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_header_id` text NOT NULL,
	`paid_date` integer NOT NULL,
	`amount` integer NOT NULL,
	`method` text DEFAULT 'BANK_TRANSFER' NOT NULL,
	`memo` text,
	`reconciled_by_id` text NOT NULL,
	`reconciled_at` integer NOT NULL,
	FOREIGN KEY (`payment_header_id`) REFERENCES `payment_headers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `payment_header_items` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_header_id` text NOT NULL,
	`purchase_recognition_id` text NOT NULL,
	`amount` integer NOT NULL,
	`tax_amount` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`payment_header_id`) REFERENCES `payment_headers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`purchase_recognition_id`) REFERENCES `purchase_recognitions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `payment_headers` (
	`id` text PRIMARY KEY NOT NULL,
	`partner_id` text NOT NULL,
	`title` text,
	`payment_date` integer NOT NULL,
	`mode` text NOT NULL,
	`period_start` integer,
	`period_end` integer,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`total_amount` integer DEFAULT 0 NOT NULL,
	`tax_amount` integer DEFAULT 0 NOT NULL,
	`reconciled_amount` integer DEFAULT 0 NOT NULL,
	`reconciliation_status` text DEFAULT 'UNRECONCILED' NOT NULL,
	`memo` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE no action
);
