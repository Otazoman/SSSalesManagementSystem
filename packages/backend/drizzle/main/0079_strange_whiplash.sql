ALTER TABLE `purchase_recognitions` ADD `project_id` text REFERENCES projects(id);--> statement-breakpoint
ALTER TABLE `quotes` ADD `project_id` text REFERENCES projects(id);--> statement-breakpoint
ALTER TABLE `sales_invoices` ADD `project_id` text REFERENCES projects(id);--> statement-breakpoint
ALTER TABLE `sales_orders` ADD `project_id` text REFERENCES projects(id);