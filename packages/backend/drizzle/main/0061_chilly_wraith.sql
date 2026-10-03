PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_purchase_request_items` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`item_id` text,
	`quantity` real NOT NULL,
	`estimated_unit_price` integer NOT NULL,
	`memo` text,
	`sales_order_item_id` text,
	`unit_code` text,
	`tax_category_code` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`item_name` text,
	`input_type` text,
	FOREIGN KEY (`request_id`) REFERENCES `purchase_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sales_order_item_id`) REFERENCES `sales_order_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tax_category_code`) REFERENCES `tax_categories`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_purchase_request_items`("id", "request_id", "item_id", "quantity", "estimated_unit_price", "memo", "sales_order_item_id", "unit_code", "tax_category_code", "sort_order", "item_name", "input_type") SELECT "id", "request_id", "item_id", "quantity", "estimated_unit_price", "memo", "sales_order_item_id", "unit_code", "tax_category_code", "sort_order", "item_name", "input_type" FROM `purchase_request_items`;--> statement-breakpoint
DROP TABLE `purchase_request_items`;--> statement-breakpoint
ALTER TABLE `__new_purchase_request_items` RENAME TO `purchase_request_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;