CREATE TABLE `billing_headers` (
	`id` text PRIMARY KEY NOT NULL,
	`partner_id` text NOT NULL,
	`title` text,
	`billing_date` integer NOT NULL,
	`mode` text NOT NULL,
	`period_start` integer,
	`period_end` integer,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`total_amount` integer DEFAULT 0 NOT NULL,
	`tax_amount` integer DEFAULT 0 NOT NULL,
	`reconciled_amount` integer DEFAULT 0 NOT NULL,
	`reconciliation_status` text DEFAULT 'UNRECONCILED' NOT NULL,
	`invoice_pdf_r2_path` text,
	`memo` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `billing_items` (
	`id` text PRIMARY KEY NOT NULL,
	`billing_header_id` text NOT NULL,
	`sales_invoice_id` text NOT NULL,
	`amount` integer NOT NULL,
	`tax_amount` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`billing_header_id`) REFERENCES `billing_headers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sales_invoice_id`) REFERENCES `sales_invoices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `payment_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`billing_header_id` text NOT NULL,
	`received_date` integer NOT NULL,
	`amount` integer NOT NULL,
	`method` text DEFAULT 'BANK_TRANSFER' NOT NULL,
	`memo` text,
	`reconciled_by_id` text NOT NULL,
	`reconciled_at` integer NOT NULL,
	FOREIGN KEY (`billing_header_id`) REFERENCES `billing_headers`(`id`) ON UPDATE no action ON DELETE cascade
);
