ALTER TABLE `order_attachments` ADD `storage_type` text DEFAULT 'R2' NOT NULL;--> statement-breakpoint
ALTER TABLE `order_attachments` ADD `external_url` text;--> statement-breakpoint
ALTER TABLE `order_items` ADD `item_name` text;--> statement-breakpoint
ALTER TABLE `order_items` ADD `input_type` text;--> statement-breakpoint
ALTER TABLE `order_items` ADD `unit_code` text;--> statement-breakpoint
ALTER TABLE `order_items` ADD `tax_category_code` text REFERENCES tax_categories(code);--> statement-breakpoint
ALTER TABLE `order_items` ADD `sort_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `title` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `total_amount` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `tax_amount` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `account_code` text REFERENCES accounts(code);--> statement-breakpoint
ALTER TABLE `orders` ADD `purchase_person_employee_number` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `input_person_employee_number` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `company_name` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `company_department` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `company_address` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `company_tel` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `company_fax` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `delivery_date` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `delivery_place` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `payment_terms` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `order_document_r2_path` text;