DROP TABLE `companies`;--> statement-breakpoint
ALTER TABLE `approval_flow_steps` ADD `target_department_surrogate_id` text REFERENCES departments(surrogate_id);