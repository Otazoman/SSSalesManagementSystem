PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_item_prices` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`price_type` text NOT NULL,
	`customer_id` text,
	`min_quantity` real DEFAULT 0 NOT NULL,
	`unit_price` integer NOT NULL,
	`unit_code` text NOT NULL,
	`status` text DEFAULT 'temporary' NOT NULL,
	`valid_from` integer NOT NULL,
	`valid_to` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_code`) REFERENCES `units`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_item_prices`("id", "item_id", "price_type", "customer_id", "min_quantity", "unit_price", "unit_code", "status", "valid_from", "valid_to", "created_by", "created_at", "updated_by", "updated_at") SELECT "id", "item_id", "price_type", "customer_id", "min_quantity", "unit_price", "unit_code", "status", "valid_from", "valid_to", "created_by", "created_at", "updated_by", "updated_at" FROM `item_prices`;--> statement-breakpoint
DROP TABLE `item_prices`;--> statement-breakpoint
ALTER TABLE `__new_item_prices` RENAME TO `item_prices`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `quotes` ADD `company_name` text;--> statement-breakpoint
ALTER TABLE `quotes` ADD `company_address` text;--> statement-breakpoint
ALTER TABLE `quotes` ADD `company_tel` text;--> statement-breakpoint
ALTER TABLE `quotes` ADD `company_fax` text;--> statement-breakpoint
ALTER TABLE `quotes` ADD `delivery_date` text;--> statement-breakpoint
ALTER TABLE `quotes` ADD `delivery_place` text;--> statement-breakpoint
ALTER TABLE `quotes` ADD `payment_terms` text;