PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text,
	`purchase_request_item_id` text,
	`item_id` text,
	`quantity` real NOT NULL,
	`unit_price` integer NOT NULL,
	`memo` text,
	`sales_order_item_id` text,
	`item_name` text,
	`input_type` text,
	`unit_code` text,
	`tax_category_code` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purchase_request_item_id`) REFERENCES `purchase_request_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sales_order_item_id`) REFERENCES `sales_order_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tax_category_code`) REFERENCES `tax_categories`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_order_items`("id", "order_id", "purchase_request_item_id", "item_id", "quantity", "unit_price", "memo", "sales_order_item_id", "item_name", "input_type", "unit_code", "tax_category_code", "sort_order") SELECT "id", "order_id", "purchase_request_item_id", "item_id", "quantity", "unit_price", "memo", "sales_order_item_id", "item_name", "input_type", "unit_code", "tax_category_code", "sort_order" FROM `order_items`;--> statement-breakpoint
DROP TABLE `order_items`;--> statement-breakpoint
ALTER TABLE `__new_order_items` RENAME TO `order_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_order_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`order_item_id` text,
	`file_name` text NOT NULL,
	`attachment_r2_path` text,
	`file_type` text DEFAULT 'OTHER' NOT NULL,
	`uploaded_by_id` text NOT NULL,
	`uploaded_at` integer NOT NULL,
	`storage_type` text DEFAULT 'R2' NOT NULL,
	`external_url` text,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_order_attachments`("id", "order_id", "order_item_id", "file_name", "attachment_r2_path", "file_type", "uploaded_by_id", "uploaded_at", "storage_type", "external_url") SELECT "id", "order_id", "order_item_id", "file_name", "attachment_r2_path", "file_type", "uploaded_by_id", "uploaded_at", "storage_type", "external_url" FROM `order_attachments`;--> statement-breakpoint
DROP TABLE `order_attachments`;--> statement-breakpoint
ALTER TABLE `__new_order_attachments` RENAME TO `order_attachments`;