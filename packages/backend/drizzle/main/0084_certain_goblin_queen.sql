CREATE TABLE `progress_case_stage_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`root_kind` text NOT NULL,
	`root_id` text NOT NULL,
	`stage_key` text NOT NULL,
	`forced_state` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `progress_case_stage_overrides_unique` ON `progress_case_stage_overrides` (`root_kind`,`root_id`,`stage_key`);