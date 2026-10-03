CREATE TABLE `partner_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`partner_id` text NOT NULL,
	`file_name` text NOT NULL,
	`storage_type` text DEFAULT 'R2' NOT NULL,
	`attachment_r2_path` text,
	`external_url` text,
	`file_type` text DEFAULT 'OTHER' NOT NULL,
	`uploaded_by_id` text NOT NULL,
	`uploaded_at` integer NOT NULL,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `partner_contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`partner_id` text NOT NULL,
	`contact_type` text NOT NULL,
	`internal_user_id` text,
	`name` text,
	`email` text,
	`phone` text,
	`fax` text,
	`department_name` text,
	`is_email_target` integer DEFAULT true NOT NULL,
	`memo` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`internal_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `partners` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'CUSTOMER' NOT NULL,
	`postal_code` text,
	`address` text,
	`phone` text,
	`fax` text,
	`credit_limit` integer DEFAULT 0 NOT NULL,
	`closing_day` integer,
	`payment_month_offset` integer,
	`payment_day` integer,
	`payment_method` text,
	`anti_social_check_status` text DEFAULT 'UNCHECKED',
	`anti_social_check_memo` text,
	`contract_date` integer,
	`contract_valid_to` integer,
	`status` text DEFAULT 'temporary' NOT NULL,
	`memo` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
DROP TABLE `customer_attachments`;--> statement-breakpoint
DROP TABLE `customer_contacts`;--> statement-breakpoint
DROP TABLE `customers`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_item_prices` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`price_type` text NOT NULL,
	`partner_id` text,
	`min_quantity` real DEFAULT 0 NOT NULL,
	`unit_price` integer NOT NULL,
	`unit_code` text NOT NULL,
	`status` text DEFAULT 'temporary' NOT NULL,
	`valid_from` integer NOT NULL,
	`valid_to` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_code`) REFERENCES `units`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_item_prices`("id", "item_id", "price_type", "partner_id", "min_quantity", "unit_price", "unit_code", "status", "valid_from", "valid_to", "created_by", "created_at", "updated_by", "updated_at") SELECT "id", "item_id", "price_type", "partner_id", "min_quantity", "unit_price", "unit_code", "status", "valid_from", "valid_to", "created_by", "created_at", "updated_by", "updated_at" FROM `item_prices`;--> statement-breakpoint
DROP TABLE `item_prices`;--> statement-breakpoint
ALTER TABLE `__new_item_prices` RENAME TO `item_prices`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_items` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_purchased` integer DEFAULT false NOT NULL,
	`is_sales` integer DEFAULT false NOT NULL,
	`is_service` integer DEFAULT false NOT NULL,
	`base_unit_code` text NOT NULL,
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
INSERT INTO `__new_items`("id", "name", "is_purchased", "is_sales", "is_service", "base_unit_code", "product_barcode", "account_code", "original_purchased_item_id", "supplier_id", "supplier_part_number", "status", "memo", "created_by", "created_at", "updated_by", "updated_at") SELECT "id", "name", "is_purchased", "is_sales", "is_service", "base_unit_code", "product_barcode", "account_code", "original_purchased_item_id", "supplier_id", "supplier_part_number", "status", "memo", "created_by", "created_at", "updated_by", "updated_at" FROM `items`;--> statement-breakpoint
DROP TABLE `items`;--> statement-breakpoint
ALTER TABLE `__new_items` RENAME TO `items`;--> statement-breakpoint
CREATE TABLE `__new_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text,
	`partner_id` text,
	`order_date` integer NOT NULL,
	`order_type` text DEFAULT 'REGULAR' NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`current_approval_layer` integer DEFAULT 1 NOT NULL,
	`approval_flow_id` text,
	`memo` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `purchase_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approval_flow_id`) REFERENCES `approval_flows`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_orders`("id", "request_id", "partner_id", "order_date", "order_type", "status", "current_approval_layer", "approval_flow_id", "memo", "created_by", "created_at", "updated_by", "updated_at") SELECT "id", "request_id", "partner_id", "order_date", "order_type", "status", "current_approval_layer", "approval_flow_id", "memo", "created_by", "created_at", "updated_by", "updated_at" FROM `orders`;--> statement-breakpoint
DROP TABLE `orders`;--> statement-breakpoint
ALTER TABLE `__new_orders` RENAME TO `orders`;--> statement-breakpoint
CREATE TABLE `__new_quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text,
	`partner_id` text NOT NULL,
	`quote_date` integer NOT NULL,
	`valid_until` integer,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`current_approval_layer` integer DEFAULT 1 NOT NULL,
	`approval_flow_id` text,
	`total_amount` integer DEFAULT 0 NOT NULL,
	`tax_amount` integer DEFAULT 0 NOT NULL,
	`memo` text,
	`terms` text,
	`company_name` text,
	`company_address` text,
	`company_tel` text,
	`company_fax` text,
	`delivery_date` text,
	`delivery_place` text,
	`payment_terms` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approval_flow_id`) REFERENCES `approval_flows`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_quotes`("id", "title", "partner_id", "quote_date", "valid_until", "status", "current_approval_layer", "approval_flow_id", "total_amount", "tax_amount", "memo", "terms", "company_name", "company_address", "company_tel", "company_fax", "delivery_date", "delivery_place", "payment_terms", "created_by", "created_at", "updated_by", "updated_at") SELECT "id", "title", "partner_id", "quote_date", "valid_until", "status", "current_approval_layer", "approval_flow_id", "total_amount", "tax_amount", "memo", "terms", "company_name", "company_address", "company_tel", "company_fax", "delivery_date", "delivery_place", "payment_terms", "created_by", "created_at", "updated_by", "updated_at" FROM `quotes`;--> statement-breakpoint
DROP TABLE `quotes`;--> statement-breakpoint
ALTER TABLE `__new_quotes` RENAME TO `quotes`;