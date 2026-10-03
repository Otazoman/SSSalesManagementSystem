CREATE TABLE `sales_order_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`sales_order_id` text NOT NULL,
	`file_name` text NOT NULL,
	`storage_type` text DEFAULT 'R2' NOT NULL,
	`attachment_r2_path` text,
	`external_url` text,
	`file_type` text DEFAULT 'OTHER' NOT NULL,
	`uploaded_by_id` text NOT NULL,
	`uploaded_at` integer NOT NULL,
	FOREIGN KEY (`sales_order_id`) REFERENCES `sales_orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sales_order_history_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`sales_order_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`action` text NOT NULL,
	`snapshot_data` text NOT NULL,
	`changed_by_id` text NOT NULL,
	`changed_at` integer NOT NULL,
	`comment` text,
	FOREIGN KEY (`sales_order_id`) REFERENCES `sales_orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sales_order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`sales_order_id` text NOT NULL,
	`source_quote_item_id` text,
	`item_id` text,
	`item_name` text,
	`input_type` text,
	`quantity` real NOT NULL,
	`unit_price` integer NOT NULL,
	`cost_price` integer,
	`amount` integer NOT NULL,
	`unit_code` text,
	`tax_category_code` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`memo` text,
	FOREIGN KEY (`sales_order_id`) REFERENCES `sales_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_quote_item_id`) REFERENCES `quote_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tax_category_code`) REFERENCES `tax_categories`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sales_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text,
	`partner_id` text NOT NULL,
	`source_quote_id` text,
	`order_date` integer NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`current_approval_layer` integer DEFAULT 1 NOT NULL,
	`approval_flow_id` text,
	`total_amount` integer DEFAULT 0 NOT NULL,
	`tax_amount` integer DEFAULT 0 NOT NULL,
	`memo` text,
	`terms` text,
	`company_name` text,
	`company_department` text,
	`company_address` text,
	`company_tel` text,
	`company_fax` text,
	`delivery_date` text,
	`delivery_place` text,
	`payment_terms` text,
	`sales_person_employee_number` text,
	`order_acknowledgment_r2_path` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_quote_id`) REFERENCES `quotes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approval_flow_id`) REFERENCES `approval_flows`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `item_shipment_headers` ADD `sales_order_id` text REFERENCES sales_orders(id);--> statement-breakpoint
ALTER TABLE `item_shipment_instruction_items` ADD `sales_order_item_id` text REFERENCES sales_order_items(id);--> statement-breakpoint
ALTER TABLE `item_shipment_instructions` ADD `sales_order_id` text REFERENCES sales_orders(id);--> statement-breakpoint
ALTER TABLE `item_shipment_items` ADD `sales_order_item_id` text REFERENCES sales_order_items(id);