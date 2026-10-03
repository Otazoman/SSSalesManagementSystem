CREATE TABLE `progress_case_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`root_kind` text NOT NULL,
	`root_id` text NOT NULL,
	`stage_key` text NOT NULL,
	`employee_number` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `progress_case_assignments_unique` ON `progress_case_assignments` (`root_kind`,`root_id`,`stage_key`);--> statement-breakpoint
CREATE TABLE `progress_stage_owners` (
	`stage_key` text PRIMARY KEY NOT NULL,
	`assignee_type` text NOT NULL,
	`assignee_ref` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL
);
