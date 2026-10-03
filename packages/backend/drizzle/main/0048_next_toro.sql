PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_item_stock_reservations` (
	`item_id` text PRIMARY KEY NOT NULL,
	`reserved_quantity` real DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_item_stock_reservations`("item_id", "reserved_quantity", "updated_at") SELECT "item_id", "reserved_quantity", "updated_at" FROM `item_stock_reservations`;--> statement-breakpoint
DROP TABLE `item_stock_reservations`;--> statement-breakpoint
ALTER TABLE `__new_item_stock_reservations` RENAME TO `item_stock_reservations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;