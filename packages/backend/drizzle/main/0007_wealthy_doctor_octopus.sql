PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_quote_items` (
	`id` text PRIMARY KEY NOT NULL,
	`quote_id` text NOT NULL,
	`item_id` text,
	`item_name` text,
	`quantity` real NOT NULL,
	`unit_price` integer NOT NULL,
	`cost_price` integer,
	`amount` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`memo` text,
	FOREIGN KEY (`quote_id`) REFERENCES `quotes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_quote_items`("id", "quote_id", "item_id", "item_name", "quantity", "unit_price", "cost_price", "amount", "sort_order", "memo") SELECT "id", "quote_id", "item_id", "item_name", "quantity", "unit_price", "cost_price", "amount", "sort_order", "memo" FROM `quote_items`;--> statement-breakpoint
DROP TABLE `quote_items`;--> statement-breakpoint
ALTER TABLE `__new_quote_items` RENAME TO `quote_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;