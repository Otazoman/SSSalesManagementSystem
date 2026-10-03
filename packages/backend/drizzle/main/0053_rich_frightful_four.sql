CREATE TABLE `item_reorder_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`reorder_point` real DEFAULT 0 NOT NULL,
	`safety_stock` real DEFAULT 0 NOT NULL,
	`memo` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `item_reorder_settings_uk` ON `item_reorder_settings` (`item_id`,`warehouse_id`);--> statement-breakpoint
ALTER TABLE `approval_flows` ADD `match_field` text;--> statement-breakpoint
ALTER TABLE `approval_flows` ADD `match_value` text;--> statement-breakpoint
ALTER TABLE `order_items` ADD `sales_order_item_id` text REFERENCES sales_order_items(id);--> statement-breakpoint
ALTER TABLE `orders` ADD `paid_at` integer;--> statement-breakpoint
ALTER TABLE `orders` ADD `is_paid` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `purchase_request_items` ADD `sales_order_item_id` text REFERENCES sales_order_items(id);