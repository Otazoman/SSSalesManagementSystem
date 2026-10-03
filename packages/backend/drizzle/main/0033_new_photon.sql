ALTER TABLE `locations` ADD `status` text DEFAULT 'temporary' NOT NULL;--> statement-breakpoint
ALTER TABLE `partner_contacts` ADD `status` text DEFAULT 'temporary' NOT NULL;--> statement-breakpoint
ALTER TABLE `units` ADD `status` text DEFAULT 'temporary' NOT NULL;