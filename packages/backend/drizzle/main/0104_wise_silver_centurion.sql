ALTER TABLE `cash_receipts` ADD `approval_status` text DEFAULT 'APPROVED' NOT NULL;--> statement-breakpoint
ALTER TABLE `payment_disbursements` ADD `approval_status` text DEFAULT 'APPROVED' NOT NULL;--> statement-breakpoint
ALTER TABLE `payment_receipts` ADD `approval_status` text DEFAULT 'APPROVED' NOT NULL;