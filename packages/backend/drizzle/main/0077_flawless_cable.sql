PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_payment_header_items` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_header_id` text NOT NULL,
	`purchase_recognition_id` text,
	`item_receipt_id` text,
	`item_name` text,
	`amount` integer NOT NULL,
	`tax_amount` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`payment_header_id`) REFERENCES `payment_headers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`purchase_recognition_id`) REFERENCES `purchase_recognitions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_receipt_id`) REFERENCES `item_receipt_headers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_payment_header_items`("id", "payment_header_id", "purchase_recognition_id", "item_receipt_id", "item_name", "amount", "tax_amount", "sort_order") SELECT "id", "payment_header_id", "purchase_recognition_id", "item_receipt_id", "item_name", "amount", "tax_amount", "sort_order" FROM `payment_header_items`;--> statement-breakpoint
DROP TABLE `payment_header_items`;--> statement-breakpoint
ALTER TABLE `__new_payment_header_items` RENAME TO `payment_header_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;