ALTER TABLE `item_receipt_headers` ADD `partner_id` text REFERENCES partners(id);--> statement-breakpoint
ALTER TABLE `item_shipment_headers` ADD `partner_id` text REFERENCES partners(id);