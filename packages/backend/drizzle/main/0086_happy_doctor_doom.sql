CREATE TABLE `document_completion_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`stage_key` text NOT NULL,
	`document_id` text NOT NULL,
	`forced_state` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_completion_overrides_unique` ON `document_completion_overrides` (`stage_key`,`document_id`);