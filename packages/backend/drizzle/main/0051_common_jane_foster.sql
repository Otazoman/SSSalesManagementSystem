CREATE TABLE `warehouse_stock_reservations` (
	`item_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`reserved_quantity` real DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`item_id`, `warehouse_id`)
);
--> statement-breakpoint
CREATE TABLE `sales_order_item_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`sales_order_item_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`reserved_quantity` real NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`sales_order_item_id`) REFERENCES `sales_order_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `sales_order_items` ADD `warehouse_allocation_request` text;--> statement-breakpoint
ALTER TABLE `sales_order_items` ADD `backordered_quantity` real DEFAULT 0 NOT NULL;