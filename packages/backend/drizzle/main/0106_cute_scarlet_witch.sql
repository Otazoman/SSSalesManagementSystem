CREATE TABLE `stock_transfer_items` (
	`id` text PRIMARY KEY NOT NULL,
	`transfer_id` text NOT NULL,
	`item_id` text NOT NULL,
	`lot_number` text DEFAULT 'NONE' NOT NULL,
	`account_code` text,
	`source_location_id` text,
	`quantity` real NOT NULL,
	`received_quantity` real DEFAULT 0 NOT NULL,
	`difference_quantity` real DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`transfer_id`) REFERENCES `stock_transfers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_code`) REFERENCES `accounts`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `stock_transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`source_warehouse_id` text NOT NULL,
	`destination_warehouse_id` text NOT NULL,
	`shipped_date` integer NOT NULL,
	`status` text DEFAULT 'SHIPPING_PENDING' NOT NULL,
	`shipment_id` text,
	`shipment_instruction_id` text,
	`receipt_instruction_id` text,
	`closed_reason` text,
	`memo` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`source_warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`destination_warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `item_receipt_items` ADD `stock_transfer_item_id` text;