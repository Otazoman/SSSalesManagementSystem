PRAGMA defer_foreign_keys=on;--> statement-breakpoint
CREATE TABLE `__new_accounts` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`external_mapping_code` text,
	`status` text DEFAULT 'temporary' NOT NULL,
	`memo` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_accounts`("code", "name", "external_mapping_code", "status", "memo", "created_by", "created_at", "updated_by", "updated_at") SELECT "code", "name", "external_mapping_code", "status", "memo", "created_by", "created_at", "updated_by", "updated_at" FROM `accounts`;--> statement-breakpoint
DROP TABLE `accounts`;--> statement-breakpoint
ALTER TABLE `__new_accounts` RENAME TO `accounts`;--> statement-breakpoint
CREATE TABLE `__new_departments` (
	`surrogate_id` text PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`parent_department_surrogate_id` text,
	`memo` text,
	`valid_from` integer NOT NULL,
	`valid_to` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`parent_department_surrogate_id`) REFERENCES `departments`(`surrogate_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_departments`("surrogate_id", "id", "name", "parent_department_surrogate_id", "memo", "valid_from", "valid_to", "created_by", "created_at", "updated_by", "updated_at") SELECT "surrogate_id", "id", "name", "parent_department_surrogate_id", "memo", "valid_from", "valid_to", "created_by", "created_at", "updated_by", "updated_at" FROM `departments`;--> statement-breakpoint
DROP TABLE `departments`;--> statement-breakpoint
ALTER TABLE `__new_departments` RENAME TO `departments`;--> statement-breakpoint
CREATE TABLE `__new_item_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`file_name` text NOT NULL,
	`storage_type` text DEFAULT 'R2' NOT NULL,
	`attachment_r2_path` text,
	`external_url` text,
	`file_type` text DEFAULT 'OTHER' NOT NULL,
	`uploaded_by_id` text NOT NULL,
	`uploaded_at` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_item_attachments`("id", "item_id", "file_name", "storage_type", "attachment_r2_path", "external_url", "file_type", "uploaded_by_id", "uploaded_at") SELECT "id", "item_id", "file_name", "storage_type", "attachment_r2_path", "external_url", "file_type", "uploaded_by_id", "uploaded_at" FROM `item_attachments`;--> statement-breakpoint
DROP TABLE `item_attachments`;--> statement-breakpoint
ALTER TABLE `__new_item_attachments` RENAME TO `item_attachments`;--> statement-breakpoint
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
	FOREIGN KEY (`unit_code`) REFERENCES `units`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_item_prices`("id", "item_id", "price_type", "partner_id", "min_quantity", "unit_price", "unit_code", "status", "valid_from", "valid_to", "created_by", "created_at", "updated_by", "updated_at") SELECT "id", "item_id", "price_type", "partner_id", "min_quantity", "unit_price", "unit_code", "status", "valid_from", "valid_to", "created_by", "created_at", "updated_by", "updated_at" FROM `item_prices`;--> statement-breakpoint
DROP TABLE `item_prices`;--> statement-breakpoint
ALTER TABLE `__new_item_prices` RENAME TO `item_prices`;--> statement-breakpoint
CREATE TABLE `__new_item_structures` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_item_id` text NOT NULL,
	`child_item_id` text NOT NULL,
	`quantity_required` real DEFAULT 1 NOT NULL,
	`revision` text DEFAULT '1.0' NOT NULL,
	`valid_from` integer NOT NULL,
	`valid_to` integer,
	`memo` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`parent_item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`child_item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_item_structures`("id", "parent_item_id", "child_item_id", "quantity_required", "revision", "valid_from", "valid_to", "memo", "created_by", "created_at", "updated_by", "updated_at") SELECT "id", "parent_item_id", "child_item_id", "quantity_required", "revision", "valid_from", "valid_to", "memo", "created_by", "created_at", "updated_by", "updated_at" FROM `item_structures`;--> statement-breakpoint
DROP TABLE `item_structures`;--> statement-breakpoint
ALTER TABLE `__new_item_structures` RENAME TO `item_structures`;--> statement-breakpoint
CREATE TABLE `__new_items` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_purchased` integer DEFAULT false NOT NULL,
	`is_sales` integer DEFAULT false NOT NULL,
	`is_service` integer DEFAULT false NOT NULL,
	`base_unit_code` text NOT NULL,
	`tax_category_code` text DEFAULT 'TAX_10' NOT NULL,
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
	FOREIGN KEY (`supplier_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_items`("id", "name", "is_purchased", "is_sales", "is_service", "base_unit_code", "tax_category_code", "product_barcode", "account_code", "original_purchased_item_id", "supplier_id", "supplier_part_number", "status", "memo", "created_by", "created_at", "updated_by", "updated_at") SELECT "id", "name", "is_purchased", "is_sales", "is_service", "base_unit_code", "tax_category_code", "product_barcode", "account_code", "original_purchased_item_id", "supplier_id", "supplier_part_number", "status", "memo", "created_by", "created_at", "updated_by", "updated_at" FROM `items`;--> statement-breakpoint
DROP TABLE `items`;--> statement-breakpoint
ALTER TABLE `__new_items` RENAME TO `items`;--> statement-breakpoint
CREATE TABLE `__new_locations` (
	`id` text PRIMARY KEY NOT NULL,
	`warehouse_id` text NOT NULL,
	`name` text NOT NULL,
	`memo` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_locations`("id", "warehouse_id", "name", "memo", "created_by", "created_at", "updated_by", "updated_at") SELECT "id", "warehouse_id", "name", "memo", "created_by", "created_at", "updated_by", "updated_at" FROM `locations`;--> statement-breakpoint
DROP TABLE `locations`;--> statement-breakpoint
ALTER TABLE `__new_locations` RENAME TO `locations`;--> statement-breakpoint
CREATE TABLE `__new_partner_contacts` (
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
	FOREIGN KEY (`internal_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_partner_contacts`("id", "partner_id", "contact_type", "internal_user_id", "name", "email", "phone", "fax", "department_name", "is_email_target", "memo", "created_by", "created_at", "updated_by", "updated_at") SELECT "id", "partner_id", "contact_type", "internal_user_id", "name", "email", "phone", "fax", "department_name", "is_email_target", "memo", "created_by", "created_at", "updated_by", "updated_at" FROM `partner_contacts`;--> statement-breakpoint
DROP TABLE `partner_contacts`;--> statement-breakpoint
ALTER TABLE `__new_partner_contacts` RENAME TO `partner_contacts`;--> statement-breakpoint
CREATE TABLE `__new_partners` (
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
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_partners`("id", "name", "type", "postal_code", "address", "phone", "fax", "credit_limit", "closing_day", "payment_month_offset", "payment_day", "payment_method", "anti_social_check_status", "anti_social_check_memo", "contract_date", "contract_valid_to", "status", "memo", "created_by", "created_at", "updated_by", "updated_at") SELECT "id", "name", "type", "postal_code", "address", "phone", "fax", "credit_limit", "closing_day", "payment_month_offset", "payment_day", "payment_method", "anti_social_check_status", "anti_social_check_memo", "contract_date", "contract_valid_to", "status", "memo", "created_by", "created_at", "updated_by", "updated_at" FROM `partners`;--> statement-breakpoint
DROP TABLE `partners`;--> statement-breakpoint
ALTER TABLE `__new_partners` RENAME TO `partners`;--> statement-breakpoint
CREATE TABLE `__new_unit_conversions` (
	`id` text PRIMARY KEY NOT NULL,
	`from_unit_code` text NOT NULL,
	`to_unit_code` text NOT NULL,
	`conversion_factor` real NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`from_unit_code`) REFERENCES `units`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_unit_code`) REFERENCES `units`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_unit_conversions`("id", "from_unit_code", "to_unit_code", "conversion_factor", "created_by", "created_at", "updated_by", "updated_at") SELECT "id", "from_unit_code", "to_unit_code", "conversion_factor", "created_by", "created_at", "updated_by", "updated_at" FROM `unit_conversions`;--> statement-breakpoint
DROP TABLE `unit_conversions`;--> statement-breakpoint
ALTER TABLE `__new_unit_conversions` RENAME TO `unit_conversions`;--> statement-breakpoint
CREATE TABLE `__new_units` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_units`("code", "name", "created_by", "created_at", "updated_by", "updated_at") SELECT "code", "name", "created_by", "created_at", "updated_by", "updated_at" FROM `units`;--> statement-breakpoint
DROP TABLE `units`;--> statement-breakpoint
ALTER TABLE `__new_units` RENAME TO `units`;--> statement-breakpoint
CREATE TABLE `__new_warehouse_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`warehouse_id` text NOT NULL,
	`file_name` text NOT NULL,
	`storage_type` text DEFAULT 'R2' NOT NULL,
	`attachment_r2_path` text,
	`external_url` text,
	`file_type` text DEFAULT 'OTHER' NOT NULL,
	`uploaded_by_id` text NOT NULL,
	`uploaded_at` integer NOT NULL,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_warehouse_attachments`("id", "warehouse_id", "file_name", "storage_type", "attachment_r2_path", "external_url", "file_type", "uploaded_by_id", "uploaded_at") SELECT "id", "warehouse_id", "file_name", "storage_type", "attachment_r2_path", "external_url", "file_type", "uploaded_by_id", "uploaded_at" FROM `warehouse_attachments`;--> statement-breakpoint
DROP TABLE `warehouse_attachments`;--> statement-breakpoint
ALTER TABLE `__new_warehouse_attachments` RENAME TO `warehouse_attachments`;--> statement-breakpoint
CREATE TABLE `__new_warehouse_available_days` (
	`id` text PRIMARY KEY NOT NULL,
	`warehouse_id` text NOT NULL,
	`available_day_of_week` text NOT NULL,
	`time_slot_memo` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_warehouse_available_days`("id", "warehouse_id", "available_day_of_week", "time_slot_memo", "created_by", "created_at", "updated_by", "updated_at") SELECT "id", "warehouse_id", "available_day_of_week", "time_slot_memo", "created_by", "created_at", "updated_by", "updated_at" FROM `warehouse_available_days`;--> statement-breakpoint
DROP TABLE `warehouse_available_days`;--> statement-breakpoint
ALTER TABLE `__new_warehouse_available_days` RENAME TO `warehouse_available_days`;--> statement-breakpoint
CREATE TABLE `__new_warehouses` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`postal_code` text,
	`address` text,
	`phone_number` text,
	`fax_number` text,
	`email` text,
	`business_start_time` text,
	`business_end_time` text,
	`storage_restrictions` text,
	`status` text DEFAULT 'temporary' NOT NULL,
	`memo` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_warehouses`("id", "name", "postal_code", "address", "phone_number", "fax_number", "email", "business_start_time", "business_end_time", "storage_restrictions", "status", "memo", "created_by", "created_at", "updated_by", "updated_at") SELECT "id", "name", "postal_code", "address", "phone_number", "fax_number", "email", "business_start_time", "business_end_time", "storage_restrictions", "status", "memo", "created_by", "created_at", "updated_by", "updated_at" FROM `warehouses`;--> statement-breakpoint
DROP TABLE `warehouses`;--> statement-breakpoint
ALTER TABLE `__new_warehouses` RENAME TO `warehouses`;--> statement-breakpoint
CREATE TABLE `__new_workflow_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`approver_id` text,
	`approver_role_id` text NOT NULL,
	`layer` integer NOT NULL,
	`status` text NOT NULL,
	`comment` text,
	`performed_at` integer,
	FOREIGN KEY (`approver_role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_workflow_logs`("id", "target_type", "target_id", "approver_id", "approver_role_id", "layer", "status", "comment", "performed_at") SELECT "id", "target_type", "target_id", "approver_id", "approver_role_id", "layer", "status", "comment", "performed_at" FROM `workflow_logs`;--> statement-breakpoint
DROP TABLE `workflow_logs`;--> statement-breakpoint
ALTER TABLE `__new_workflow_logs` RENAME TO `workflow_logs`;--> statement-breakpoint
CREATE TABLE `__new_item_receipt_headers` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text,
	`received_date` integer NOT NULL,
	`supplier_invoice_number` text,
	`attachment_r2_path` text,
	`status` text DEFAULT 'UNAPPROVED' NOT NULL,
	`current_approval_layer` integer DEFAULT 1 NOT NULL,
	`approval_flow_id` text,
	`memo` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approval_flow_id`) REFERENCES `approval_flows`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_item_receipt_headers`("id", "order_id", "received_date", "supplier_invoice_number", "attachment_r2_path", "status", "current_approval_layer", "approval_flow_id", "memo", "created_by", "created_at") SELECT "id", "order_id", "received_date", "supplier_invoice_number", "attachment_r2_path", "status", "current_approval_layer", "approval_flow_id", "memo", "created_by", "created_at" FROM `item_receipt_headers`;--> statement-breakpoint
DROP TABLE `item_receipt_headers`;--> statement-breakpoint
ALTER TABLE `__new_item_receipt_headers` RENAME TO `item_receipt_headers`;--> statement-breakpoint
CREATE TABLE `__new_journal_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_date` integer NOT NULL,
	`debit_account_code` text NOT NULL,
	`debit_amount` integer NOT NULL,
	`credit_account_code` text NOT NULL,
	`credit_amount` integer NOT NULL,
	`description` text NOT NULL,
	`source_ref_id` text,
	`memo` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`debit_account_code`) REFERENCES `accounts`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`credit_account_code`) REFERENCES `accounts`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_journal_entries`("id", "entry_date", "debit_account_code", "debit_amount", "credit_account_code", "credit_amount", "description", "source_ref_id", "memo", "created_by", "created_at") SELECT "id", "entry_date", "debit_account_code", "debit_amount", "credit_account_code", "credit_amount", "description", "source_ref_id", "memo", "created_by", "created_at" FROM `journal_entries`;--> statement-breakpoint
DROP TABLE `journal_entries`;--> statement-breakpoint
ALTER TABLE `__new_journal_entries` RENAME TO `journal_entries`;--> statement-breakpoint
CREATE TABLE `__new_master_approval_contexts` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`anti_social_check_status` text,
	`anti_social_check_memo` text,
	`contract_type` text,
	`contract_valid_from` integer,
	`contract_valid_to` integer,
	`contract_memo` text,
	`drawing_number` text,
	`specification_memo` text,
	`general_memo` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `master_approval_requests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_master_approval_contexts`("id", "request_id", "anti_social_check_status", "anti_social_check_memo", "contract_type", "contract_valid_from", "contract_valid_to", "contract_memo", "drawing_number", "specification_memo", "general_memo", "created_by", "created_at", "updated_by", "updated_at") SELECT "id", "request_id", "anti_social_check_status", "anti_social_check_memo", "contract_type", "contract_valid_from", "contract_valid_to", "contract_memo", "drawing_number", "specification_memo", "general_memo", "created_by", "created_at", "updated_by", "updated_at" FROM `master_approval_contexts`;--> statement-breakpoint
DROP TABLE `master_approval_contexts`;--> statement-breakpoint
ALTER TABLE `__new_master_approval_contexts` RENAME TO `master_approval_contexts`;--> statement-breakpoint
CREATE TABLE `__new_master_approval_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`request_type` text NOT NULL,
	`status` text NOT NULL,
	`applicant_id` text NOT NULL,
	`approver_id` text,
	`comment` text,
	`attachment_r2_path` text,
	`memo` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_master_approval_requests`("id", "target_type", "target_id", "request_type", "status", "applicant_id", "approver_id", "comment", "attachment_r2_path", "memo", "created_at", "updated_at") SELECT "id", "target_type", "target_id", "request_type", "status", "applicant_id", "approver_id", "comment", "attachment_r2_path", "memo", "created_at", "updated_at" FROM `master_approval_requests`;--> statement-breakpoint
DROP TABLE `master_approval_requests`;--> statement-breakpoint
ALTER TABLE `__new_master_approval_requests` RENAME TO `master_approval_requests`;--> statement-breakpoint
CREATE TABLE `__new_order_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`order_item_id` text,
	`file_name` text NOT NULL,
	`attachment_r2_path` text NOT NULL,
	`file_type` text DEFAULT 'OTHER' NOT NULL,
	`uploaded_by_id` text NOT NULL,
	`uploaded_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_order_attachments`("id", "order_id", "order_item_id", "file_name", "attachment_r2_path", "file_type", "uploaded_by_id", "uploaded_at") SELECT "id", "order_id", "order_item_id", "file_name", "attachment_r2_path", "file_type", "uploaded_by_id", "uploaded_at" FROM `order_attachments`;--> statement-breakpoint
DROP TABLE `order_attachments`;--> statement-breakpoint
ALTER TABLE `__new_order_attachments` RENAME TO `order_attachments`;--> statement-breakpoint
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
	FOREIGN KEY (`approval_flow_id`) REFERENCES `approval_flows`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_orders`("id", "request_id", "partner_id", "order_date", "order_type", "status", "current_approval_layer", "approval_flow_id", "memo", "created_by", "created_at", "updated_by", "updated_at") SELECT "id", "request_id", "partner_id", "order_date", "order_type", "status", "current_approval_layer", "approval_flow_id", "memo", "created_by", "created_at", "updated_by", "updated_at" FROM `orders`;--> statement-breakpoint
DROP TABLE `orders`;--> statement-breakpoint
ALTER TABLE `__new_orders` RENAME TO `orders`;--> statement-breakpoint
CREATE TABLE `__new_purchase_request_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`purchase_request_item_id` text,
	`file_name` text NOT NULL,
	`attachment_r2_path` text NOT NULL,
	`uploaded_by_id` text NOT NULL,
	`uploaded_at` integer NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `purchase_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purchase_request_item_id`) REFERENCES `purchase_request_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_purchase_request_attachments`("id", "request_id", "purchase_request_item_id", "file_name", "attachment_r2_path", "uploaded_by_id", "uploaded_at") SELECT "id", "request_id", "purchase_request_item_id", "file_name", "attachment_r2_path", "uploaded_by_id", "uploaded_at" FROM `purchase_request_attachments`;--> statement-breakpoint
DROP TABLE `purchase_request_attachments`;--> statement-breakpoint
ALTER TABLE `__new_purchase_request_attachments` RENAME TO `purchase_request_attachments`;--> statement-breakpoint
CREATE TABLE `__new_purchase_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`department_surrogate_id` text NOT NULL,
	`applicant_id` text NOT NULL,
	`request_type` text DEFAULT 'CONSUMABLE' NOT NULL,
	`status` text NOT NULL,
	`current_approval_layer` integer DEFAULT 1 NOT NULL,
	`approval_flow_id` text,
	`total_amount` integer NOT NULL,
	`memo` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`department_surrogate_id`) REFERENCES `departments`(`surrogate_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approval_flow_id`) REFERENCES `approval_flows`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_purchase_requests`("id", "title", "department_surrogate_id", "applicant_id", "request_type", "status", "current_approval_layer", "approval_flow_id", "total_amount", "memo", "created_by", "created_at", "updated_by", "updated_at") SELECT "id", "title", "department_surrogate_id", "applicant_id", "request_type", "status", "current_approval_layer", "approval_flow_id", "total_amount", "memo", "created_by", "created_at", "updated_by", "updated_at" FROM `purchase_requests`;--> statement-breakpoint
DROP TABLE `purchase_requests`;--> statement-breakpoint
ALTER TABLE `__new_purchase_requests` RENAME TO `purchase_requests`;--> statement-breakpoint
CREATE TABLE `__new_quote_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`quote_id` text NOT NULL,
	`file_name` text NOT NULL,
	`storage_type` text DEFAULT 'R2' NOT NULL,
	`attachment_r2_path` text,
	`external_url` text,
	`file_type` text DEFAULT 'OTHER' NOT NULL,
	`uploaded_by_id` text NOT NULL,
	`uploaded_at` integer NOT NULL,
	FOREIGN KEY (`quote_id`) REFERENCES `quotes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_quote_attachments`("id", "quote_id", "file_name", "storage_type", "attachment_r2_path", "external_url", "file_type", "uploaded_by_id", "uploaded_at") SELECT "id", "quote_id", "file_name", "storage_type", "attachment_r2_path", "external_url", "file_type", "uploaded_by_id", "uploaded_at" FROM `quote_attachments`;--> statement-breakpoint
DROP TABLE `quote_attachments`;--> statement-breakpoint
ALTER TABLE `__new_quote_attachments` RENAME TO `quote_attachments`;--> statement-breakpoint
CREATE TABLE `__new_quote_history_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`quote_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`action` text NOT NULL,
	`snapshot_data` text NOT NULL,
	`changed_by_id` text NOT NULL,
	`changed_at` integer NOT NULL,
	`comment` text,
	FOREIGN KEY (`quote_id`) REFERENCES `quotes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_quote_history_logs`("id", "quote_id", "version", "action", "snapshot_data", "changed_by_id", "changed_at", "comment") SELECT "id", "quote_id", "version", "action", "snapshot_data", "changed_by_id", "changed_at", "comment" FROM `quote_history_logs`;--> statement-breakpoint
DROP TABLE `quote_history_logs`;--> statement-breakpoint
ALTER TABLE `__new_quote_history_logs` RENAME TO `quote_history_logs`;--> statement-breakpoint
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
	`company_department` text,
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
	FOREIGN KEY (`approval_flow_id`) REFERENCES `approval_flows`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_quotes`("id", "title", "partner_id", "quote_date", "valid_until", "status", "current_approval_layer", "approval_flow_id", "total_amount", "tax_amount", "memo", "terms", "company_name", "company_department", "company_address", "company_tel", "company_fax", "delivery_date", "delivery_place", "payment_terms", "created_by", "created_at", "updated_by", "updated_at") SELECT "id", "title", "partner_id", "quote_date", "valid_until", "status", "current_approval_layer", "approval_flow_id", "total_amount", "tax_amount", "memo", "terms", "company_name", "company_department", "company_address", "company_tel", "company_fax", "delivery_date", "delivery_place", "payment_terms", "created_by", "created_at", "updated_by", "updated_at" FROM `quotes`;--> statement-breakpoint
DROP TABLE `quotes`;--> statement-breakpoint
ALTER TABLE `__new_quotes` RENAME TO `quotes`;--> statement-breakpoint
CREATE TABLE `__new_stock_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`location_id` text NOT NULL,
	`lot_number` text DEFAULT 'NONE' NOT NULL,
	`quantity` real NOT NULL,
	`type` text NOT NULL,
	`ref_id` text,
	`qr_code_key` text,
	`memo` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_stock_transactions`("id", "item_id", "warehouse_id", "location_id", "lot_number", "quantity", "type", "ref_id", "qr_code_key", "memo", "created_by", "created_at") SELECT "id", "item_id", "warehouse_id", "location_id", "lot_number", "quantity", "type", "ref_id", "qr_code_key", "memo", "created_by", "created_at" FROM `stock_transactions`;--> statement-breakpoint
DROP TABLE `stock_transactions`;--> statement-breakpoint
ALTER TABLE `__new_stock_transactions` RENAME TO `stock_transactions`;--> statement-breakpoint
PRAGMA defer_foreign_keys=off;