ALTER TABLE `payment_header_items` ADD `item_receipt_id` text REFERENCES item_receipt_headers(id);--> statement-breakpoint
ALTER TABLE `payment_header_items` ADD `item_name` text;