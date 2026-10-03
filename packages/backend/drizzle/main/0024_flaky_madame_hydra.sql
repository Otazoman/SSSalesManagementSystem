PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_items` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_purchased` integer DEFAULT false NOT NULL,
	`is_sales` integer DEFAULT false NOT NULL,
	`is_service` integer DEFAULT false NOT NULL,
	`base_unit_code` text NOT NULL,
	`tax_category_code` text DEFAULT 'TAX_10' NOT NULL,
	`product_barcode` text,
	`account_code` text,
	`original_purchased_item_id` text,
	`supplier_id` text,
	`supplier_part_number` text,
	`status` text DEFAULT 'temporary' NOT NULL,
	`memo` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`base_unit_code`) REFERENCES `units`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_code`) REFERENCES `accounts`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supplier_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_items`("id", "name", "is_purchased", "is_sales", "is_service", "base_unit_code", "tax_category_code", "product_barcode", "account_code", "original_purchased_item_id", "supplier_id", "supplier_part_number", "status", "memo", "created_by", "created_at", "updated_by", "updated_at") SELECT "id", "name", "is_purchased", "is_sales", "is_service", "base_unit_code", "tax_category_code", "product_barcode", "account_code", "original_purchased_item_id", "supplier_id", "supplier_part_number", "status", "memo", "created_by", "created_at", "updated_by", "updated_at" FROM `items`;--> statement-breakpoint
DROP TABLE `items`;--> statement-breakpoint
ALTER TABLE `__new_items` RENAME TO `items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;