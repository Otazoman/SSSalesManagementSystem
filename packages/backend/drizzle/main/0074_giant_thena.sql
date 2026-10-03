ALTER TABLE `billing_items` ADD `item_name` text;--> statement-breakpoint
ALTER TABLE `billing_items` ADD `quantity` real;--> statement-breakpoint
ALTER TABLE `billing_items` ADD `unit_price` integer;--> statement-breakpoint
ALTER TABLE `billing_items` ADD `tax_category_code` text REFERENCES tax_categories(code);