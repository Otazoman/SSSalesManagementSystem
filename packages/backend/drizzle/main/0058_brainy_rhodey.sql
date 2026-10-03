ALTER TABLE `purchase_request_attachments` ADD `storage_type` text DEFAULT 'R2' NOT NULL;--> statement-breakpoint
ALTER TABLE `purchase_request_attachments` ADD `external_url` text;--> statement-breakpoint
ALTER TABLE `purchase_requests` ADD `partner_id` text REFERENCES partners(id);--> statement-breakpoint
ALTER TABLE `purchase_requests` ADD `partner_name` text;--> statement-breakpoint
ALTER TABLE `purchase_requests` ADD `partner_input_type` text;