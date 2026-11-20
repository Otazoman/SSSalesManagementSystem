ALTER TABLE `orders` ADD `is_direct_shipment` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `direct_sales_order_id` text REFERENCES sales_orders(id);--> statement-breakpoint
ALTER TABLE `purchase_requests` ADD `is_direct_shipment` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `purchase_requests` ADD `direct_sales_order_id` text REFERENCES sales_orders(id);