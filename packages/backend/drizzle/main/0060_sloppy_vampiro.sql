ALTER TABLE `purchase_request_items` ADD `unit_code` text;--> statement-breakpoint
ALTER TABLE `purchase_request_items` ADD `tax_category_code` text REFERENCES tax_categories(code);--> statement-breakpoint
ALTER TABLE `purchase_request_items` ADD `sort_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `purchase_requests` ADD `account_code` text REFERENCES accounts(code);--> statement-breakpoint
ALTER TABLE `purchase_requests` ADD `input_person_employee_number` text;--> statement-breakpoint
ALTER TABLE `purchase_requests` ADD `tax_amount` integer;