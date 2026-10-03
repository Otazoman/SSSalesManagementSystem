CREATE TABLE `item_receipt_instruction_items` (
	`id` text PRIMARY KEY NOT NULL,
	`instruction_header_id` text,
	`item_id` text NOT NULL,
	`lot_number` text DEFAULT 'NONE' NOT NULL,
	`instructed_quantity` real NOT NULL,
	`account_code` text NOT NULL,
	`memo` text,
	FOREIGN KEY (`instruction_header_id`) REFERENCES `item_receipt_instructions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_code`) REFERENCES `accounts`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `item_receipt_instructions` (
	`id` text PRIMARY KEY NOT NULL,
	`partner_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`instructed_receive_date` integer NOT NULL,
	`status` text DEFAULT 'UNAPPROVED' NOT NULL,
	`current_approval_layer` integer DEFAULT 1 NOT NULL,
	`approval_flow_id` text,
	`instruction_document_r2_path` text,
	`memo` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approval_flow_id`) REFERENCES `approval_flows`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `item_shipment_instruction_items` (
	`id` text PRIMARY KEY NOT NULL,
	`instruction_header_id` text,
	`item_id` text NOT NULL,
	`lot_number` text DEFAULT 'NONE' NOT NULL,
	`instructed_quantity` real NOT NULL,
	`account_code` text NOT NULL,
	`memo` text,
	FOREIGN KEY (`instruction_header_id`) REFERENCES `item_shipment_instructions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_code`) REFERENCES `accounts`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `item_shipment_instructions` (
	`id` text PRIMARY KEY NOT NULL,
	`partner_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`instructed_ship_date` integer NOT NULL,
	`status` text DEFAULT 'UNAPPROVED' NOT NULL,
	`current_approval_layer` integer DEFAULT 1 NOT NULL,
	`approval_flow_id` text,
	`instruction_document_r2_path` text,
	`memo` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approval_flow_id`) REFERENCES `approval_flows`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `item_receipt_headers` ADD `receipt_instruction_id` text REFERENCES item_receipt_instructions(id);--> statement-breakpoint
ALTER TABLE `item_shipment_headers` ADD `shipment_instruction_id` text REFERENCES item_shipment_instructions(id);