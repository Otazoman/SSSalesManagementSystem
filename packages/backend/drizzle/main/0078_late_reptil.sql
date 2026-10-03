CREATE TABLE `partner_bank_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`partner_id` text NOT NULL,
	`bank_name` text NOT NULL,
	`bank_code` text,
	`branch_name` text NOT NULL,
	`branch_code` text,
	`account_type` text DEFAULT 'ORDINARY' NOT NULL,
	`account_number` text NOT NULL,
	`account_holder_name` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`memo` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE cascade
);
