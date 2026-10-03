PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_billing_items` (
	`id` text PRIMARY KEY NOT NULL,
	`billing_header_id` text NOT NULL,
	`sales_invoice_id` text,
	`amount` integer NOT NULL,
	`tax_amount` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`item_name` text,
	`quantity` real,
	`unit_price` integer,
	`tax_category_code` text,
	FOREIGN KEY (`billing_header_id`) REFERENCES `billing_headers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sales_invoice_id`) REFERENCES `sales_invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tax_category_code`) REFERENCES `tax_categories`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_billing_items`("id", "billing_header_id", "sales_invoice_id", "amount", "tax_amount", "sort_order", "item_name", "quantity", "unit_price", "tax_category_code") SELECT "id", "billing_header_id", "sales_invoice_id", "amount", "tax_amount", "sort_order", "item_name", "quantity", "unit_price", "tax_category_code" FROM `billing_items`;--> statement-breakpoint
DROP TABLE `billing_items`;--> statement-breakpoint
ALTER TABLE `__new_billing_items` RENAME TO `billing_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;