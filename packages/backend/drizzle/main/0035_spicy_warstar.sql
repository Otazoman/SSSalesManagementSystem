CREATE TABLE `item_shipment_headers` (
	`id` text PRIMARY KEY NOT NULL,
	`shipped_date` integer NOT NULL,
	`status` text DEFAULT 'UNAPPROVED' NOT NULL,
	`current_approval_layer` integer DEFAULT 1 NOT NULL,
	`approval_flow_id` text,
	`memo` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`approval_flow_id`) REFERENCES `approval_flows`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `item_shipment_items` (
	`id` text PRIMARY KEY NOT NULL,
	`shipment_header_id` text,
	`item_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`location_id` text NOT NULL,
	`lot_number` text DEFAULT 'NONE' NOT NULL,
	`quality_status` text DEFAULT 'NORMAL' NOT NULL,
	`shipped_quantity` real NOT NULL,
	`account_code` text NOT NULL,
	`qr_code_key` text,
	`memo` text,
	FOREIGN KEY (`shipment_header_id`) REFERENCES `item_shipment_headers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_code`) REFERENCES `accounts`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `stocks` ADD `quality_status` text DEFAULT 'NORMAL' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `stocks_uk` ON `stocks` (`item_id`,`warehouse_id`,`location_id`,`lot_number`,`account_code`,`quality_status`);--> statement-breakpoint
ALTER TABLE `warehouses` ADD `warehouse_type` text DEFAULT 'INTERNAL' NOT NULL;--> statement-breakpoint
ALTER TABLE `stock_transactions` ADD `quality_status` text DEFAULT 'NORMAL' NOT NULL;