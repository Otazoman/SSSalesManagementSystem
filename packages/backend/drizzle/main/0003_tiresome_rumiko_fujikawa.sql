ALTER TABLE `item_structures` ADD `revision` text DEFAULT '1.0' NOT NULL;--> statement-breakpoint
ALTER TABLE `item_structures` ADD `valid_from` integer NOT NULL;--> statement-breakpoint
ALTER TABLE `item_structures` ADD `valid_to` integer;