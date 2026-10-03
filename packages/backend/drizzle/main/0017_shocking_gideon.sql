PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_approval_flow_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`flow_id` text NOT NULL,
	`step_order` integer NOT NULL,
	`approver_role_id` text NOT NULL,
	`target_department_surrogate_id` text,
	`step_name` text,
	`memo` text,
	FOREIGN KEY (`flow_id`) REFERENCES `approval_flows`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`approver_role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_department_surrogate_id`) REFERENCES `departments`(`surrogate_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_approval_flow_steps`("id", "flow_id", "step_order", "approver_role_id", "target_department_surrogate_id", "step_name", "memo") SELECT "id", "flow_id", "step_order", "approver_role_id", "target_department_surrogate_id", "step_name", "memo" FROM `approval_flow_steps`;--> statement-breakpoint
DROP TABLE `approval_flow_steps`;--> statement-breakpoint
ALTER TABLE `__new_approval_flow_steps` RENAME TO `approval_flow_steps`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_item_receipt_items` (
	`id` text PRIMARY KEY NOT NULL,
	`receipt_header_id` text,
	`order_item_id` text,
	`warehouse_id` text NOT NULL,
	`location_id` text NOT NULL,
	`lot_number` text DEFAULT 'NONE' NOT NULL,
	`received_quantity` real NOT NULL,
	`account_code` text NOT NULL,
	`inspection_status` text DEFAULT 'PASSED' NOT NULL,
	`inspection_memo` text,
	`actual_product_photo_r2_path` text,
	`item_attachment_r2_path` text,
	`qr_code_key` text,
	`memo` text,
	FOREIGN KEY (`receipt_header_id`) REFERENCES `item_receipt_headers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_code`) REFERENCES `accounts`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_item_receipt_items`("id", "receipt_header_id", "order_item_id", "warehouse_id", "location_id", "lot_number", "received_quantity", "account_code", "inspection_status", "inspection_memo", "actual_product_photo_r2_path", "item_attachment_r2_path", "qr_code_key", "memo") SELECT "id", "receipt_header_id", "order_item_id", "warehouse_id", "location_id", "lot_number", "received_quantity", "account_code", "inspection_status", "inspection_memo", "actual_product_photo_r2_path", "item_attachment_r2_path", "qr_code_key", "memo" FROM `item_receipt_items`;--> statement-breakpoint
DROP TABLE `item_receipt_items`;--> statement-breakpoint
ALTER TABLE `__new_item_receipt_items` RENAME TO `item_receipt_items`;--> statement-breakpoint
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
	`created_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_stock_transactions`("id", "item_id", "warehouse_id", "location_id", "lot_number", "quantity", "type", "ref_id", "qr_code_key", "memo", "created_by", "created_at") SELECT "id", "item_id", "warehouse_id", "location_id", "lot_number", "quantity", "type", "ref_id", "qr_code_key", "memo", "created_by", "created_at" FROM `stock_transactions`;--> statement-breakpoint
DROP TABLE `stock_transactions`;--> statement-breakpoint
ALTER TABLE `__new_stock_transactions` RENAME TO `stock_transactions`;