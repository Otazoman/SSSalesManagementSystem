ALTER TABLE `order_items` ADD `account_code` text REFERENCES accounts(code);--> statement-breakpoint
ALTER TABLE `purchase_recognition_items` ADD `account_code` text REFERENCES accounts(code);--> statement-breakpoint
ALTER TABLE `purchase_request_items` ADD `account_code` text REFERENCES accounts(code);--> statement-breakpoint
ALTER TABLE `sales_invoice_items` ADD `account_code` text REFERENCES accounts(code);--> statement-breakpoint
ALTER TABLE `sales_order_items` ADD `account_code` text REFERENCES accounts(code);