CREATE TABLE `business_locations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`postal_code` text,
	`address` text,
	`phone_number` text,
	`status` text DEFAULT 'temporary' NOT NULL,
	`memo` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL
);
