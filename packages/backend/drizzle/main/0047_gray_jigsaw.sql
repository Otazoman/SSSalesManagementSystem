CREATE TABLE `item_stock_reservations` (
	`item_id` text PRIMARY KEY NOT NULL,
	`reserved_quantity` real DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action
);
