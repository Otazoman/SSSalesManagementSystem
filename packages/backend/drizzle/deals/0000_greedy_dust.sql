CREATE TABLE `deal_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`deal_id` text NOT NULL,
	`file_name` text NOT NULL,
	`attachment_r2_path` text NOT NULL,
	`file_type` text DEFAULT 'OTHER' NOT NULL,
	`uploaded_by_id` text NOT NULL,
	`uploaded_at` integer NOT NULL,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_deal_attachments_deal` ON `deal_attachments` (`deal_id`);--> statement-breakpoint
CREATE TABLE `deal_attendees` (
	`id` text PRIMARY KEY NOT NULL,
	`deal_id` text NOT NULL,
	`kind` text NOT NULL,
	`ref_id` text,
	`name` text NOT NULL,
	`note` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_deal_attendees_deal` ON `deal_attendees` (`deal_id`);--> statement-breakpoint
CREATE TABLE `deal_quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`deal_id` text NOT NULL,
	`quote_id` text NOT NULL,
	`linked_by` text NOT NULL,
	`linked_at` integer NOT NULL,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_deal_quotes_deal_quote` ON `deal_quotes` (`deal_id`,`quote_id`);--> statement-breakpoint
CREATE INDEX `idx_deal_quotes_quote` ON `deal_quotes` (`quote_id`);--> statement-breakpoint
CREATE TABLE `deal_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`deal_id` text NOT NULL,
	`title` text NOT NULL,
	`due_date` integer,
	`assignee_employee_number` text,
	`is_done` integer DEFAULT false NOT NULL,
	`done_at` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_deal_tasks_deal` ON `deal_tasks` (`deal_id`);--> statement-breakpoint
CREATE INDEX `idx_deal_tasks_assignee` ON `deal_tasks` (`assignee_employee_number`,`is_done`);--> statement-breakpoint
CREATE TABLE `deals` (
	`id` text PRIMARY KEY NOT NULL,
	`partner_id` text NOT NULL,
	`title` text NOT NULL,
	`deal_date` integer NOT NULL,
	`start_time` text,
	`end_time` text,
	`location` text,
	`memo` text,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`owner_employee_number` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_deals_partner` ON `deals` (`partner_id`);--> statement-breakpoint
CREATE INDEX `idx_deals_date` ON `deals` (`deal_date`);--> statement-breakpoint
CREATE TABLE `prospect_contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`partner_id` text NOT NULL,
	`name` text NOT NULL,
	`department_name` text,
	`position` text,
	`email` text,
	`phone` text,
	`memo` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_prospect_contacts_partner` ON `prospect_contacts` (`partner_id`);