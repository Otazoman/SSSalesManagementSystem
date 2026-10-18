ALTER TABLE `order_items` ADD `requested_delivery_date` text;--> statement-breakpoint
ALTER TABLE `order_items` ADD `answered_delivery_date` text;--> statement-breakpoint
ALTER TABLE `sales_order_items` ADD `delivery_date` text;