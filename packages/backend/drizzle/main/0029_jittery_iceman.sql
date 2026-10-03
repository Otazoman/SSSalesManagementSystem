ALTER TABLE `quote_items` ADD `unit_code` text;--> statement-breakpoint
ALTER TABLE `quote_items` ADD `tax_category_code` text REFERENCES tax_categories(code);