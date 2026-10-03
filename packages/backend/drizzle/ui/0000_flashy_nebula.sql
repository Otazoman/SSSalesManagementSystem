CREATE TABLE `announcements` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`publish_date` text NOT NULL,
	`end_date` text,
	`is_important` integer DEFAULT false NOT NULL,
	`is_published` integer DEFAULT true NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_announcements_publish` ON `announcements` (`is_published`,`publish_date`);--> statement-breakpoint
CREATE TABLE `screen_descriptions` (
	`path` text PRIMARY KEY NOT NULL,
	`description_html` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`theme_mode` text DEFAULT 'system' NOT NULL,
	`accent_color` text DEFAULT 'indigo' NOT NULL,
	`updated_at` text NOT NULL
);
